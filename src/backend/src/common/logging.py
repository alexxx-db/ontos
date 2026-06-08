import logging
import sys
from typing import Optional


def setup_logging(
    level: int = logging.INFO,
    format: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    log_file: Optional[str] = None
) -> None:
    """Configure logging for the application.
    
    Args:
        level: Logging level (default: INFO)
        format: Log message format
        log_file: Optional file path to write logs to
    """
    handlers = [logging.StreamHandler(sys.stdout)]

    if log_file:
        handlers.append(logging.FileHandler(log_file))

    logging.basicConfig(
        level=level,
        format=format,
        handlers=handlers
    )

    # Force uvicorn loggers to use the same format so all lines include timestamps
    formatter = logging.Formatter(format)
    for uvicorn_logger_name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        uv_logger = logging.getLogger(uvicorn_logger_name)
        uv_logger.handlers.clear()
        uv_handler = logging.StreamHandler(sys.stdout)
        uv_handler.setFormatter(formatter)
        uv_logger.addHandler(uv_handler)
        if log_file:
            uv_file_handler = logging.FileHandler(log_file)
            uv_file_handler.setFormatter(formatter)
            uv_logger.addHandler(uv_file_handler)
        uv_logger.propagate = False

def get_logger(name: str) -> logging.Logger:
    """Get a logger instance with the specified name.
    
    Args:
        name: Logger name, typically __name__ from the calling module
        
    Returns:
        Configured logger instance
    """
    return logging.getLogger(name)
