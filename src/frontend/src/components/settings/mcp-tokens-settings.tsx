/**
 * MCP Tokens Settings Component
 * 
 * Allows administrators to create, view, and revoke MCP API tokens
 * for AI assistant integrations.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  AlertTriangle,
  Clock,
  Shield,
  Loader2,
  RefreshCw,
  Eye,
  EyeOff,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import {
  MCPTokenInfo,
  MCPTokenList,
  MCPTokenResponse,
  MCPTokenCreate,
  MCP_SCOPE_CATEGORIES,
} from '@/types/mcp-token';

export default function MCPTokensSettings() {
  const { t } = useTranslation(['settings', 'common']);
  const { toast } = useToast();
  const { get, post, del } = useApi();

  // State
  const [tokens, setTokens] = useState<MCPTokenInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);

  // Create dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenScopes, setNewTokenScopes] = useState<string[]>([]);
  const [newTokenExpiresDays, setNewTokenExpiresDays] = useState<number | null>(90);
  const [isCreating, setIsCreating] = useState(false);

  // Token created dialog (shows the token once)
  const [createdToken, setCreatedToken] = useState<MCPTokenResponse | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [showToken, setShowToken] = useState(false);

  // Revoke dialog state
  const [tokenToRevoke, setTokenToRevoke] = useState<MCPTokenInfo | null>(null);

  // Load tokens
  const loadTokens = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await get<MCPTokenList>(
        `/api/mcp-tokens?include_inactive=${includeInactive}`
      );
      if (response.data?.tokens) {
        setTokens(response.data.tokens);
      }
    } catch (error) {
      console.error('Failed to load MCP tokens:', error);
      toast({
        title: 'Error',
        description: 'Failed to load MCP tokens',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [get, includeInactive, toast]);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  // Handle scope toggle
  const toggleScope = (scope: string) => {
    setNewTokenScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  // Create token
  const handleCreateToken = async () => {
    if (!newTokenName.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Token name is required',
        variant: 'destructive',
      });
      return;
    }

    if (newTokenScopes.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'At least one scope is required',
        variant: 'destructive',
      });
      return;
    }

    setIsCreating(true);
    try {
      const payload: MCPTokenCreate = {
        name: newTokenName.trim(),
        scopes: newTokenScopes,
        expires_days: newTokenExpiresDays,
      };

      const response = await post<MCPTokenResponse>('/api/mcp-tokens', payload);

      if (response.error) {
        throw new Error(response.error);
      }

      if (response.data) {
        setCreatedToken(response.data);
        setCreateDialogOpen(false);
        setNewTokenName('');
        setNewTokenScopes([]);
        setNewTokenExpiresDays(90);
        loadTokens();
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create token',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  // Copy token to clipboard
  const handleCopyToken = async () => {
    if (createdToken?.token) {
      await navigator.clipboard.writeText(createdToken.token);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
      toast({
        title: 'Copied',
        description: 'Token copied to clipboard',
      });
    }
  };

  // Revoke token
  const handleRevokeToken = async () => {
    if (!tokenToRevoke) return;

    try {
      const response = await del(`/api/mcp-tokens/${tokenToRevoke.id}`);

      if (response.error) {
        throw new Error(response.error);
      }

      toast({
        title: 'Token Revoked',
        description: `Token "${tokenToRevoke.name}" has been revoked`,
      });

      setTokenToRevoke(null);
      loadTokens();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to revoke token',
        variant: 'destructive',
      });
    }
  };

  // Format date
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    try {
      return format(new Date(dateStr), 'MMM d, yyyy HH:mm');
    } catch {
      return dateStr;
    }
  };

  // Format relative date
  const formatRelative = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch {
      return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Key className="h-6 w-6 text-primary" />
            <div>
              <CardTitle>MCP API Tokens</CardTitle>
              <CardDescription>
                Manage API tokens for AI assistant integrations via the Model Context Protocol
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadTokens}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Token
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Filter */}
        <div className="flex items-center gap-2 mb-4">
          <Checkbox
            id="include-inactive"
            checked={includeInactive}
            onCheckedChange={(checked) => setIncludeInactive(!!checked)}
          />
          <Label htmlFor="include-inactive" className="text-sm text-muted-foreground">
            Show revoked tokens
          </Label>
        </div>

        {/* Tokens Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : tokens.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Key className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">No MCP tokens yet</p>
            <p className="text-sm">Create a token to allow AI assistants to access your tools</p>
          </div>
        ) : (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => (
                  <TableRow key={token.id} className={!token.is_active ? 'opacity-50' : ''}>
                    <TableCell className="font-medium">{token.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-[300px]">
                        {token.scopes.slice(0, 3).map((scope) => (
                          <Badge key={scope} variant="secondary" className="text-xs">
                            {scope}
                          </Badge>
                        ))}
                        {token.scopes.length > 3 && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <Badge variant="outline" className="text-xs">
                                  +{token.scopes.length - 3} more
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="flex flex-col gap-1">
                                  {token.scopes.slice(3).map((scope) => (
                                    <span key={scope}>{scope}</span>
                                  ))}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger className="text-sm">
                            {formatRelative(token.created_at) || formatDate(token.created_at)}
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs">
                              <div>{formatDate(token.created_at)}</div>
                              {token.created_by && (
                                <div className="text-muted-foreground">by {token.created_by}</div>
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell>
                      {token.last_used_at ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger className="text-sm">
                              {formatRelative(token.last_used_at)}
                            </TooltipTrigger>
                            <TooltipContent>{formatDate(token.last_used_at)}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        <span className="text-muted-foreground text-sm">Never</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {token.expires_at ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger
                              className={`text-sm flex items-center gap-1 ${
                                token.is_expired ? 'text-destructive' : ''
                              }`}
                            >
                              {token.is_expired && <AlertTriangle className="h-3 w-3" />}
                              {formatRelative(token.expires_at)}
                            </TooltipTrigger>
                            <TooltipContent>{formatDate(token.expires_at)}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        <span className="text-muted-foreground text-sm">Never</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {!token.is_active ? (
                        <Badge variant="secondary" className="bg-muted">
                          Revoked
                        </Badge>
                      ) : token.is_expired ? (
                        <Badge variant="destructive">Expired</Badge>
                      ) : (
                        <Badge variant="default" className="bg-green-600">
                          Active
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {token.is_active && !token.is_expired && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setTokenToRevoke(token)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Revoke token</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Info Section */}
        <div className="mt-6 p-4 bg-muted/50 rounded-lg">
          <h4 className="font-medium flex items-center gap-2 mb-2">
            <Shield className="h-4 w-4" />
            Using MCP Tokens
          </h4>
          <p className="text-sm text-muted-foreground mb-2">
            MCP tokens allow AI assistants to interact with your data governance platform.
            Each token has specific scopes that control which tools can be accessed.
          </p>
          <div className="text-sm text-muted-foreground">
            <strong>Endpoint:</strong>{' '}
            <code className="bg-background px-1 rounded">/api/mcp</code>
          </div>
          <div className="text-sm text-muted-foreground">
            <strong>Header:</strong>{' '}
            <code className="bg-background px-1 rounded">X-API-Key: mcp_...</code>
          </div>
        </div>
      </CardContent>

      {/* Create Token Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Create MCP Token
            </DialogTitle>
            <DialogDescription>
              Create a new API token for AI assistant integrations. The token will only be shown
              once.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Token Name */}
            <div className="space-y-2">
              <Label htmlFor="token-name">Token Name *</Label>
              <Input
                id="token-name"
                placeholder="e.g., Claude Assistant - Analytics Team"
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                A descriptive name to identify this token
              </p>
            </div>

            {/* Expiration */}
            <div className="space-y-2">
              <Label htmlFor="token-expires">Expiration (days)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="token-expires"
                  type="number"
                  min={1}
                  max={365}
                  placeholder="90"
                  value={newTokenExpiresDays ?? ''}
                  onChange={(e) =>
                    setNewTokenExpiresDays(e.target.value ? parseInt(e.target.value) : null)
                  }
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">
                  Leave empty for no expiration
                </span>
              </div>
            </div>

            {/* Scopes */}
            <div className="space-y-2">
              <Label>Scopes *</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Select the permissions this token should have
              </p>
              <ScrollArea className="h-[300px] border rounded-lg p-4">
                {Object.entries(MCP_SCOPE_CATEGORIES).map(([category, scopes]) => (
                  <div key={category} className="mb-4">
                    <h5 className="font-medium text-sm mb-2">{category}</h5>
                    <div className="space-y-2">
                      {scopes.map((scope) => (
                        <div key={scope.value} className="flex items-start gap-2">
                          <Checkbox
                            id={`scope-${scope.value}`}
                            checked={newTokenScopes.includes(scope.value)}
                            onCheckedChange={() => toggleScope(scope.value)}
                          />
                          <div className="grid gap-0.5">
                            <Label
                              htmlFor={`scope-${scope.value}`}
                              className="text-sm font-medium cursor-pointer"
                            >
                              {scope.label}
                            </Label>
                            <p className="text-xs text-muted-foreground">{scope.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <Separator className="mt-3" />
                  </div>
                ))}
              </ScrollArea>
              {newTokenScopes.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  <span className="text-xs text-muted-foreground">Selected:</span>
                  {newTokenScopes.map((scope) => (
                    <Badge key={scope} variant="secondary" className="text-xs">
                      {scope}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateToken} disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Token
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Token Created Dialog */}
      <Dialog open={!!createdToken} onOpenChange={() => setCreatedToken(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <Check className="h-5 w-5" />
              Token Created Successfully
            </DialogTitle>
            <DialogDescription>
              <span className="text-destructive font-medium">
                Copy this token now — it won't be shown again!
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Token Name</Label>
              <div className="font-medium">{createdToken?.name}</div>
            </div>

            <div className="space-y-2">
              <Label>API Token</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <Input
                    readOnly
                    type={showToken ? 'text' : 'password'}
                    value={createdToken?.token || ''}
                    className="pr-20 font-mono text-sm"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7"
                    onClick={() => setShowToken(!showToken)}
                  >
                    {showToken ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <Button onClick={handleCopyToken} variant={tokenCopied ? 'default' : 'secondary'}>
                  {tokenCopied ? (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Scopes</Label>
              <div className="flex flex-wrap gap-1">
                {createdToken?.scopes.map((scope) => (
                  <Badge key={scope} variant="secondary">
                    {scope}
                  </Badge>
                ))}
              </div>
            </div>

            {createdToken?.expires_at && (
              <div className="space-y-2">
                <Label>Expires</Label>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  {formatDate(createdToken.expires_at)}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => setCreatedToken(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirmation Dialog */}
      <AlertDialog open={!!tokenToRevoke} onOpenChange={() => setTokenToRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Revoke Token?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke the token <strong>"{tokenToRevoke?.name}"</strong>?
              <br />
              <br />
              This action cannot be undone. Any AI assistants using this token will immediately
              lose access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevokeToken}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoke Token
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

