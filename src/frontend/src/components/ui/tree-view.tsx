import * as React from "react"
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface TreeDataItem {
  id: string
  name: string
  icon?: React.ReactNode
  children?: TreeDataItem[]
  onClick?: () => void
  selected?: boolean
  expanded?: boolean
  onExpand?: () => void
  onCollapse?: () => void
  loading?: boolean
  hasChildren: boolean
}

interface TreeViewProps {
  data: TreeDataItem[]
  initialSelectedItemId?: string
  onSelectChange?: (item: TreeDataItem) => void
  className?: string
}

export function TreeView({
  data,
  initialSelectedItemId,
  onSelectChange,
  className,
}: TreeViewProps) {
  const [expandedItems, setExpandedItems] = React.useState<Set<string>>(new Set())
  // Track items explicitly collapsed by user to override parent's expanded prop
  const [collapsedItems, setCollapsedItems] = React.useState<Set<string>>(new Set())
  const [selectedItemId, setSelectedItemId] = React.useState<string | undefined>(initialSelectedItemId)

  const handleToggle = (item: TreeDataItem) => {
    if (item.loading) return;

    // Check if currently expanded (considering both internal state, collapsed override, and parent prop)
    const isCurrentlyExpanded = expandedItems.has(item.id) || 
      (item.expanded && !collapsedItems.has(item.id));
    
    if (isCurrentlyExpanded) {
      // Collapsing
      setExpandedItems((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      // Mark as explicitly collapsed to override parent's expanded prop
      setCollapsedItems((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
      // Notify parent of collapse so it can sync its state
      if (item.onCollapse) {
        item.onCollapse();
      }
    } else {
      // Expanding
      setExpandedItems((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
      // Remove from collapsed set since user is expanding
      setCollapsedItems((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      if (item.onExpand) {
        item.onExpand();
      }
    }
  };

  const handleSelect = (item: TreeDataItem) => {
    setSelectedItemId(item.id)
    if (onSelectChange) {
      onSelectChange(item)
    }
    if (item.onClick) {
      item.onClick()
    }
  }

  const renderItem = (item: TreeDataItem, level: number = 0) => {
    const hasChildren = item.hasChildren || (item.children && item.children.length > 0);
    // Item is expanded if: in internal expanded set, OR parent says expanded AND not explicitly collapsed
    const isExpanded = expandedItems.has(item.id) || 
      (item.expanded && !collapsedItems.has(item.id));
    const isSelected = selectedItemId === item.id;

    return (
      <div key={item.id} className="space-y-1">
        <div
          className={cn(
            "flex items-center justify-between p-2 hover:bg-muted rounded-md cursor-pointer",
            isSelected && "bg-muted"
          )}
          style={{ paddingLeft: `${level * 16}px` }}
          onClick={() => handleSelect(item)}
        >
          <div className="flex items-center space-x-2 min-w-0">
            {hasChildren && (
              <button
                className="h-4 w-4 flex-shrink-0 flex items-center justify-center"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggle(item);
                }}
              >
                {item.loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            )}
            {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
            <span className="truncate">{item.name}</span>
          </div>
        </div>
        {hasChildren && isExpanded && (
          <div className="ml-4">
            {item.children?.map((child) => renderItem(child, level + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1 overflow-auto h-full", className)}>
      <div className="min-w-full inline-block">
        {data.map((item) => renderItem(item))}
      </div>
    </div>
  )
} 