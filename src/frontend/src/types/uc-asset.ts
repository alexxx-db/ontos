/**
 * Unity Catalog Asset Types
 * 
 * Types for the UC Asset Lookup Dialog and related components.
 * Supports all Unity Catalog securable types.
 */

// ============================================================================
// UC Asset Types Enum
// ============================================================================

/**
 * Enumeration of Unity Catalog asset types.
 * Matches the backend UnifiedAssetType for UC objects.
 */
export enum UCAssetType {
  // Container types (for navigation, not selectable as leaf)
  CATALOG = 'catalog',
  SCHEMA = 'schema',
  
  // Data assets
  TABLE = 'table',
  VIEW = 'view',
  MATERIALIZED_VIEW = 'materialized_view',
  STREAMING_TABLE = 'streaming_table',
  
  // Compute assets
  FUNCTION = 'function',
  MODEL = 'model',
  
  // Storage assets
  VOLUME = 'volume',
  
  // Semantic assets
  METRIC = 'metric',
}

/**
 * Asset types that can be selected as leaf nodes (not containers).
 */
export const SELECTABLE_ASSET_TYPES: UCAssetType[] = [
  UCAssetType.TABLE,
  UCAssetType.VIEW,
  UCAssetType.MATERIALIZED_VIEW,
  UCAssetType.STREAMING_TABLE,
  UCAssetType.FUNCTION,
  UCAssetType.MODEL,
  UCAssetType.VOLUME,
  UCAssetType.METRIC,
];

/**
 * Default set of all selectable asset types.
 */
export const ALL_ASSET_TYPES = SELECTABLE_ASSET_TYPES;

// ============================================================================
// UC Asset Info Interface
// ============================================================================

/**
 * Information about a selected UC asset.
 * Returned when a user selects an asset in the UC Asset Lookup Dialog.
 */
export interface UCAssetInfo {
  /** Catalog name */
  catalog_name: string;
  /** Schema name */
  schema_name: string;
  /** Object name (table, view, function, etc.) */
  object_name: string;
  /** Fully qualified name (catalog.schema.object) */
  full_name: string;
  /** Type of the asset */
  asset_type: UCAssetType;
  /** Optional description/comment */
  description?: string;
}

// ============================================================================
// Tree Item Types
// ============================================================================

/**
 * Catalog tree item used in the lookup dialog.
 */
export interface CatalogTreeItem {
  /** Unique ID (FQN for nested items) */
  id: string;
  /** Display name */
  name: string;
  /** Item type */
  type: UCAssetType;
  /** Child items (loaded lazily) */
  children: CatalogTreeItem[];
  /** Whether this item can have children */
  hasChildren: boolean;
  /** Optional description */
  description?: string;
}

// ============================================================================
// Type Prefix Mapping
// ============================================================================

/**
 * Mapping of type prefixes to asset types.
 * Used for the type prefix search syntax (e.g., "t:catalog.schema.table").
 * Keys are all valid prefixes that map to the corresponding asset type.
 */
export const TYPE_PREFIX_MAP: Record<string, UCAssetType> = {
  // Table prefixes
  't': UCAssetType.TABLE,
  'ta': UCAssetType.TABLE,
  'tab': UCAssetType.TABLE,
  'tabl': UCAssetType.TABLE,
  'table': UCAssetType.TABLE,
  
  // View prefixes
  'v': UCAssetType.VIEW,
  'vi': UCAssetType.VIEW,
  'vie': UCAssetType.VIEW,
  'view': UCAssetType.VIEW,
  
  // Materialized view prefixes
  'mv': UCAssetType.MATERIALIZED_VIEW,
  'mat': UCAssetType.MATERIALIZED_VIEW,
  'materialized': UCAssetType.MATERIALIZED_VIEW,
  'materialized_view': UCAssetType.MATERIALIZED_VIEW,
  
  // Streaming table prefixes
  'st': UCAssetType.STREAMING_TABLE,
  'str': UCAssetType.STREAMING_TABLE,
  'stream': UCAssetType.STREAMING_TABLE,
  'streaming': UCAssetType.STREAMING_TABLE,
  'streaming_table': UCAssetType.STREAMING_TABLE,
  
  // Function prefixes
  'f': UCAssetType.FUNCTION,
  'fu': UCAssetType.FUNCTION,
  'fun': UCAssetType.FUNCTION,
  'func': UCAssetType.FUNCTION,
  'function': UCAssetType.FUNCTION,
  
  // Model prefixes
  'm': UCAssetType.MODEL,
  'mo': UCAssetType.MODEL,
  'mod': UCAssetType.MODEL,
  'model': UCAssetType.MODEL,
  
  // Volume prefixes
  'vol': UCAssetType.VOLUME,
  'volu': UCAssetType.VOLUME,
  'volum': UCAssetType.VOLUME,
  'volume': UCAssetType.VOLUME,
  
  // Metric prefixes
  'met': UCAssetType.METRIC,
  'metr': UCAssetType.METRIC,
  'metri': UCAssetType.METRIC,
  'metric': UCAssetType.METRIC,
};

/**
 * Get display name for an asset type.
 */
export function getAssetTypeDisplayName(type: UCAssetType): string {
  switch (type) {
    case UCAssetType.CATALOG:
      return 'Catalog';
    case UCAssetType.SCHEMA:
      return 'Schema';
    case UCAssetType.TABLE:
      return 'Table';
    case UCAssetType.VIEW:
      return 'View';
    case UCAssetType.MATERIALIZED_VIEW:
      return 'Materialized View';
    case UCAssetType.STREAMING_TABLE:
      return 'Streaming Table';
    case UCAssetType.FUNCTION:
      return 'Function';
    case UCAssetType.MODEL:
      return 'Model';
    case UCAssetType.VOLUME:
      return 'Volume';
    case UCAssetType.METRIC:
      return 'Metric';
    default:
      return 'Unknown';
  }
}

/**
 * Check if an asset type is a container (catalog or schema).
 */
export function isContainerType(type: UCAssetType): boolean {
  return type === UCAssetType.CATALOG || type === UCAssetType.SCHEMA;
}

/**
 * Check if an asset type is selectable (not a container).
 */
export function isSelectableType(type: UCAssetType): boolean {
  return SELECTABLE_ASSET_TYPES.includes(type);
}
