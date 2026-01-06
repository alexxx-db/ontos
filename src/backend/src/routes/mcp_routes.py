"""
FastAPI routes for MCP (Model Context Protocol) server.

Implements a JSON-RPC 2.0 endpoint for MCP clients to interact with application tools.
"""

import json
from datetime import datetime
from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Depends, Header, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.common.config import Settings, get_settings
from src.common.database import get_db
from src.common.logging import get_logger
from src.controller.mcp_tokens_manager import MCPTokensManager, MCPTokenInfo
from src.tools.base import ToolContext, ToolResult
from src.tools.registry import create_default_registry

logger = get_logger(__name__)

router = APIRouter(prefix="/api/mcp", tags=["MCP"])


def register_routes(app):
    """Register MCP routes with the FastAPI app."""
    app.include_router(router)


# JSON-RPC 2.0 Error Codes
JSONRPC_PARSE_ERROR = -32700
JSONRPC_INVALID_REQUEST = -32600
JSONRPC_METHOD_NOT_FOUND = -32601
JSONRPC_INVALID_PARAMS = -32602
JSONRPC_INTERNAL_ERROR = -32603

# Custom MCP Error Codes
MCP_AUTH_FAILED = -32001
MCP_AUTH_MISSING_SCOPE = -32002


class JSONRPCRequest(BaseModel):
    """JSON-RPC 2.0 request."""
    jsonrpc: str = Field(default="2.0")
    method: str
    params: Optional[Dict[str, Any]] = None
    id: Optional[Union[str, int]] = None


class JSONRPCError(BaseModel):
    """JSON-RPC 2.0 error."""
    code: int
    message: str
    data: Optional[Any] = None


class JSONRPCResponse(BaseModel):
    """JSON-RPC 2.0 response."""
    jsonrpc: str = "2.0"
    result: Optional[Any] = None
    error: Optional[JSONRPCError] = None
    id: Optional[Union[str, int]] = None


def make_error_response(
    code: int,
    message: str,
    data: Any = None,
    request_id: Optional[Union[str, int]] = None
) -> JSONRPCResponse:
    """Create a JSON-RPC error response."""
    return JSONRPCResponse(
        error=JSONRPCError(code=code, message=message, data=data),
        id=request_id
    )


def make_success_response(
    result: Any,
    request_id: Optional[Union[str, int]] = None
) -> JSONRPCResponse:
    """Create a JSON-RPC success response."""
    return JSONRPCResponse(result=result, id=request_id)


class MCPHandler:
    """Handler for MCP JSON-RPC methods."""
    
    def __init__(
        self,
        db: Session,
        settings: Settings,
        token_info: MCPTokenInfo,
        request: Request
    ):
        self._db = db
        self._settings = settings
        self._token_info = token_info
        self._request = request
        self._tool_registry = create_default_registry()
    
    async def handle(self, rpc_request: JSONRPCRequest) -> JSONRPCResponse:
        """Route the request to the appropriate handler."""
        method = rpc_request.method
        params = rpc_request.params or {}
        request_id = rpc_request.id
        
        handlers = {
            "initialize": self._handle_initialize,
            "notifications/initialized": self._handle_initialized,
            "ping": self._handle_ping,
            "tools/list": self._handle_tools_list,
            "tools/call": self._handle_tools_call,
        }
        
        handler = handlers.get(method)
        if not handler:
            return make_error_response(
                JSONRPC_METHOD_NOT_FOUND,
                f"Method not found: {method}",
                request_id=request_id
            )
        
        try:
            result = await handler(params)
            return make_success_response(result, request_id=request_id)
        except MCPError as e:
            return make_error_response(e.code, e.message, e.data, request_id=request_id)
        except Exception as e:
            logger.error(f"Error handling MCP method {method}: {e}", exc_info=True)
            return make_error_response(
                JSONRPC_INTERNAL_ERROR,
                f"Internal error: {str(e)}",
                request_id=request_id
            )
    
    async def _handle_initialize(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle initialize request."""
        return {
            "protocolVersion": "2024-11-05",
            "serverInfo": {
                "name": "ontos-mcp-server",
                "version": "1.0.0"
            },
            "capabilities": {
                "tools": {}
            }
        }
    
    async def _handle_initialized(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle initialized notification."""
        return {}
    
    async def _handle_ping(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle ping request."""
        return {"pong": True, "timestamp": datetime.utcnow().isoformat()}
    
    async def _handle_tools_list(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle tools/list request, filtering by token scopes."""
        all_tools = self._tool_registry.get_mcp_definitions()
        
        # Filter tools by scope
        filtered_tools = []
        for tool_def in all_tools:
            tool = self._tool_registry.get(tool_def["name"])
            if tool:
                required_scope = getattr(tool, "required_scope", "*")
                if self._has_scope(required_scope):
                    filtered_tools.append(tool_def)
        
        return {"tools": filtered_tools}
    
    async def _handle_tools_call(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle tools/call request."""
        tool_name = params.get("name")
        tool_args = params.get("arguments", {})
        
        if not tool_name:
            raise MCPError(JSONRPC_INVALID_PARAMS, "Missing tool name")
        
        # Get the tool
        tool = self._tool_registry.get(tool_name)
        if not tool:
            raise MCPError(JSONRPC_METHOD_NOT_FOUND, f"Tool not found: {tool_name}")
        
        # Check scope
        required_scope = getattr(tool, "required_scope", "*")
        if not self._has_scope(required_scope):
            raise MCPError(
                MCP_AUTH_MISSING_SCOPE,
                f"Missing required scope: {required_scope}",
                {"required_scope": required_scope, "token_scopes": self._token_info.scopes}
            )
        
        # Create tool context
        ctx = self._create_tool_context()
        
        # Execute the tool
        try:
            result = await tool.execute(ctx, **tool_args)
            
            # Format result for MCP
            if result.success:
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(result.data, default=str)
                        }
                    ],
                    "isError": False
                }
            else:
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": result.error or "Unknown error"
                        }
                    ],
                    "isError": True
                }
                
        except Exception as e:
            logger.error(f"Error executing tool {tool_name}: {e}", exc_info=True)
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Tool execution failed: {str(e)}"
                    }
                ],
                "isError": True
            }
    
    def _has_scope(self, required_scope: str) -> bool:
        """Check if token has required scope."""
        scopes = self._token_info.scopes
        
        # Admin wildcard
        if "*" in scopes:
            return True
        
        # Exact match
        if required_scope in scopes:
            return True
        
        # Prefix wildcard
        if ":" in required_scope:
            prefix = required_scope.split(":")[0]
            if f"{prefix}:*" in scopes:
                return True
        
        return False
    
    def _create_tool_context(self) -> ToolContext:
        """Create a ToolContext for tool execution."""
        # Get managers from app.state if available
        app = self._request.app
        
        return ToolContext(
            db=self._db,
            settings=self._settings,
            workspace_client=getattr(app.state, "workspace_client", None),
            data_products_manager=getattr(app.state, "data_products_manager", None),
            data_contracts_manager=getattr(app.state, "data_contracts_manager", None),
            semantic_models_manager=getattr(app.state, "semantic_models_manager", None),
            costs_manager=None,  # Add if needed
            search_manager=getattr(app.state, "search_manager", None)
        )


class MCPError(Exception):
    """MCP-specific error with JSON-RPC code."""
    def __init__(self, code: int, message: str, data: Any = None):
        self.code = code
        self.message = message
        self.data = data
        super().__init__(message)


@router.post("")
async def mcp_handler(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    """
    MCP JSON-RPC 2.0 endpoint.
    
    Requires X-API-Key header with a valid MCP token.
    Supports methods: initialize, notifications/initialized, ping, tools/list, tools/call
    """
    # Validate API key
    if not x_api_key:
        return JSONRPCResponse(
            error=JSONRPCError(
                code=MCP_AUTH_FAILED,
                message="Missing X-API-Key header"
            )
        ).model_dump()
    
    # Validate token
    token_manager = MCPTokensManager(db=db)
    token_info = token_manager.validate_token(x_api_key)
    
    if not token_info:
        return JSONRPCResponse(
            error=JSONRPCError(
                code=MCP_AUTH_FAILED,
                message="Invalid or expired API key"
            )
        ).model_dump()
    
    # Parse request body
    try:
        body = await request.json()
    except Exception as e:
        return JSONRPCResponse(
            error=JSONRPCError(
                code=JSONRPC_PARSE_ERROR,
                message=f"Failed to parse JSON: {str(e)}"
            )
        ).model_dump()
    
    # Validate JSON-RPC format
    try:
        rpc_request = JSONRPCRequest(**body)
    except Exception as e:
        return JSONRPCResponse(
            error=JSONRPCError(
                code=JSONRPC_INVALID_REQUEST,
                message=f"Invalid request: {str(e)}"
            )
        ).model_dump()
    
    # Log the request
    logger.info(f"MCP request: method={rpc_request.method}, token={token_info.name}")
    
    # Handle the request
    handler = MCPHandler(db, settings, token_info, request)
    response = await handler.handle(rpc_request)
    
    # Commit any changes
    try:
        db.commit()
    except Exception as e:
        logger.error(f"Error committing MCP changes: {e}")
        db.rollback()
    
    return response.model_dump()


@router.get("/health")
async def mcp_health():
    """Health check endpoint for MCP server."""
    return {"status": "ok", "server": "ontos-mcp-server", "version": "1.0.0"}

