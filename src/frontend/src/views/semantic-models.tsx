import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { 
  SemanticModel, 
  OntologyConcept, 
  ConceptHierarchy, 
  GroupedConcepts,
  TaxonomyStats
} from '@/types/ontology';
import type { EntitySemanticLink } from '@/types/semantic-link';
import { useTree } from '@headless-tree/react';
import { 
  syncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
  searchFeature
} from '@headless-tree/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DataTable } from '@/components/ui/data-table';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ColumnDef } from '@tanstack/react-table';
import {
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Layers,
  Zap,
  Search,
  Network,
  Loader2,
  ExternalLink,
  Filter,
  FolderTree,
  Link2,
} from 'lucide-react';
import ReactFlow, { Node, Edge, Background, MarkerType, Controls, ConnectionMode } from 'reactflow';
import 'reactflow/dist/style.css';
import { KnowledgeGraph } from '@/components/semantic-models/knowledge-graph';
import useBreadcrumbStore from '@/stores/breadcrumb-store';
import { useGlossaryPreferencesStore } from '@/stores/glossary-preferences-store';
import { usePermissions } from '@/stores/permissions-store';
import { FeatureAccessLevel } from '@/types/feature-access-levels';
import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';


// Define concept item type for Headless Tree
type ConceptTreeItem = {
  id: string;
  concept: OntologyConcept;
  name: string;
  children: ConceptTreeItem[];
};

interface ConceptTreeItemProps {
  item: any;
  selectedConcept: OntologyConcept | null;
  onSelectConcept: (concept: OntologyConcept) => void;
}

const ConceptTreeItem: React.FC<ConceptTreeItemProps> = ({ item, selectedConcept, onSelectConcept }) => {
  const concept = item.getItemData() as OntologyConcept;
  const isSelected = selectedConcept?.iri === concept.iri;
  const level = item.getItemMeta().level;
  const isSourceGroup = concept.iri.startsWith('source:');
  
  const getConceptIcon = () => {
    if (isSourceGroup) {
      return <FolderTree className="h-4 w-4 shrink-0 text-orange-500" />;
    }
    switch (concept.concept_type) {
      case 'class':
        return <Layers className="h-4 w-4 shrink-0 text-blue-500" />;
      case 'concept':
        return <Layers className="h-4 w-4 shrink-0 text-green-500" />;
      default:
        return <Zap className="h-4 w-4 shrink-0 text-yellow-500" />;
    }
  };

  const getDisplayName = () => {
    return concept.label || concept.iri.split(/[/#]/).pop() || concept.iri;
  };

  const handleClick = () => {
    // Don't trigger concept selection for source group nodes
    if (!isSourceGroup) {
      onSelectConcept(concept);
    }
  };

  return (
    <div
      {...item.getProps()}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer w-full text-left",
        "hover:bg-accent hover:text-accent-foreground transition-colors",
        isSelected && !isSourceGroup && "bg-accent text-accent-foreground",
        isSourceGroup && "font-semibold bg-muted/50"
      )}
      style={{ paddingLeft: `${level * 12 + 8}px` }}
      onClick={handleClick}
    >
      <div className="flex items-center w-5 justify-center">
        {item.isFolder() && (
          <button
            className="p-0.5 hover:bg-muted rounded"
            onClick={(e) => {
              e.stopPropagation();
              if (item.isExpanded()) {
                item.collapse();
              } else {
                item.expand();
              }
            }}
          >
            {item.isExpanded() ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            )}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {getConceptIcon()}
        <span 
          className="truncate text-sm font-medium" 
          title={`${getDisplayName()}${!isSourceGroup && concept.source_context ? ` (${concept.source_context})` : ''}`}
        >
          {getDisplayName()}
        </span>
      </div>
    </div>
  );
};

interface UnifiedConceptTreeProps {
  concepts: OntologyConcept[];
  selectedConcept: OntologyConcept | null;
  onSelectConcept: (concept: OntologyConcept) => void;
  searchQuery: string;
  onShowKnowledgeGraph?: () => void;
  groupBySource?: boolean;
}

const UnifiedConceptTree: React.FC<UnifiedConceptTreeProps> = ({
  concepts,
  selectedConcept,
  onSelectConcept,
  searchQuery,
  onShowKnowledgeGraph,
  groupBySource = false
}) => {
  const { t } = useTranslation(['semantic-models', 'common']);
  
  // Helper function to find the path from root to a specific concept
  // const findPathToConcept = useCallback((targetIri: string, conceptMap: Map<string, OntologyConcept>, hierarchy: Map<string, string[]>): string[] => {
  //   const visited = new Set<string>();
  //
  //   const findPath = (currentIri: string, path: string[]): string[] | null => {
  //     if (visited.has(currentIri)) return null;
  //     visited.add(currentIri);
  //
  //     if (currentIri === targetIri) {
  //       return [...path, currentIri];
  //     }
  //
  //     // Check children
  //     const children = hierarchy.get(currentIri) || [];
  //     for (const childIri of children) {
  //       const result = findPath(childIri, [...path, currentIri]);
  //       if (result) return result;
  //     }
  //
  //     return null;
  //   };
  //
  //   // Start from root
  //   const result = findPath('root', []);
  //   return result || [];
  // }, []);

  // Build hierarchical data structure for Headless Tree
  const treeData = useMemo(() => {
    const conceptMap = new Map<string, OntologyConcept>();
    const hierarchy = new Map<string, string[]>();
    const sourceContexts = new Set<string>();

    // Only show classes and concepts (explicit positive filtering to match graph)
    const baseConcepts = concepts.filter(concept => {
      const conceptType = (concept as any).concept_type as string;
      return conceptType === 'class' || conceptType === 'concept';
    });
    
    // Build concept map and hierarchy
    baseConcepts.forEach(concept => {
      conceptMap.set(concept.iri, concept);
      
      // Track source contexts
      if (concept.source_context) {
        sourceContexts.add(concept.source_context);
      }

      // Build parent-child relationships from parent_concepts
      concept.parent_concepts.forEach(parentIri => {
        if (!hierarchy.has(parentIri)) {
          hierarchy.set(parentIri, []);
        }
        // Only add if not already present to avoid duplicates
        const parentChildren = hierarchy.get(parentIri)!;
        if (!parentChildren.includes(concept.iri)) {
          parentChildren.push(concept.iri);
        }
      });
      
      // Ensure concept is in the map even if it has no children
      if (!hierarchy.has(concept.iri)) {
        hierarchy.set(concept.iri, []);
      }
    });
    
    return { conceptMap, hierarchy, sourceContexts: Array.from(sourceContexts).sort() };
  }, [concepts]);
  
  const tree = useTree<OntologyConcept>({
    rootItemId: 'root',
    getItemName: (item) => {
      const concept = item.getItemData();
      return concept.label || concept.iri.split(/[/#]/).pop() || concept.iri;
    },
    isItemFolder: (item) => {
      const concept = item.getItemData();
      // Check if it's a source group node
      if (concept.iri.startsWith('source:')) {
        return true;
      }
      const children = treeData.hierarchy.get(concept.iri) || [];
      const hasChildConcepts = concept.child_concepts && concept.child_concepts.length > 0;
      return children.length > 0 || hasChildConcepts;
    },
    dataLoader: {
      getItem: (itemId: string) => {
        if (itemId === 'root') {
          // Provide a minimal object satisfying OntologyConcept shape
          return {
            iri: 'root',
            label: 'Root',
            concept_type: 'root' as any,
            parent_concepts: [],
            child_concepts: [],
            properties: {},
            tagged_assets: [],
            source_context: 'root'
          } as unknown as OntologyConcept;
        }
        // Handle source group nodes
        if (itemId.startsWith('source:')) {
          const sourceName = itemId.substring(7);
          return {
            iri: itemId,
            label: sourceName,
            concept_type: 'source_group' as any,
            parent_concepts: [],
            child_concepts: [],
            properties: {},
            tagged_assets: [],
            source_context: sourceName
          } as unknown as OntologyConcept;
        }
        const found = treeData.conceptMap.get(itemId);
        if (!found) {
          // Fallback to a minimal placeholder to satisfy return type
          return {
            iri: itemId,
            label: itemId.split(/[/#]/).pop() || itemId,
            concept_type: 'concept' as any,
            parent_concepts: [],
            child_concepts: [],
            properties: {},
            tagged_assets: [],
            source_context: 'unknown'
          } as unknown as OntologyConcept;
        }
        return found;
      },
      getChildren: (itemId: string) => {
        if (itemId === 'root') {
          if (groupBySource && treeData.sourceContexts.length > 0) {
            // Return source context nodes as children of root
            return treeData.sourceContexts.map(source => `source:${source}`);
          }
          // Return root-level concepts (those with no parents or parents not in our dataset)
          const rootConcepts = Array.from(treeData.conceptMap.values())
            .filter(concept => {
              return concept.parent_concepts.length === 0 || 
                     !concept.parent_concepts.some(parentIri => treeData.conceptMap.has(parentIri));
            })
            .map(concept => concept.iri);
          return rootConcepts;
        }
        // Handle source group nodes - return root concepts from that source
        if (itemId.startsWith('source:')) {
          const sourceName = itemId.substring(7);
          const sourceRootConcepts = Array.from(treeData.conceptMap.values())
            .filter(concept => {
              const matchesSource = concept.source_context === sourceName;
              const isRootLevel = concept.parent_concepts.length === 0 || 
                     !concept.parent_concepts.some(parentIri => treeData.conceptMap.has(parentIri));
              return matchesSource && isRootLevel;
            })
            .map(concept => concept.iri);
          return sourceRootConcepts;
        }
        return treeData.hierarchy.get(itemId) || [];
      },
    },
    initialState: {
      expandedItems: ['root'],
    },
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      ...(searchQuery ? [searchFeature] : [])
    ],
  });

  // Effect to expand tree path when selected concept changes
  useEffect(() => {
    if (selectedConcept && treeData.conceptMap.has(selectedConcept.iri)) {
      // Use a timeout to ensure tree is fully loaded
      const expandPath = () => {
        // Expand all ancestor concepts of the selected concept
        // Build a set of all ancestors by walking parent_concepts recursively
        const ancestorsToExpand = new Set<string>();
        const stack: string[] = [...selectedConcept.parent_concepts];
        while (stack.length > 0) {
          const current = stack.pop() as string;
          if (!treeData.conceptMap.has(current)) continue;
          if (ancestorsToExpand.has(current)) continue;
          ancestorsToExpand.add(current);
          const parentConcept = treeData.conceptMap.get(current)!;
          parentConcept.parent_concepts.forEach((p) => stack.push(p));
        }

        // Expand any ancestor items that already exist in the tree; repeated calls
        // will progressively expand deeper ancestors as they are created
        const items = tree.getItems();
        items.forEach((item) => {
          const id = item.getId();
          if (ancestorsToExpand.has(id) && !item.isExpanded()) {
            item.expand();
          }
        });
      };
      
      // Execute immediately and also with a small delay to handle async tree loading
      expandPath();
      setTimeout(expandPath, 100);
      setTimeout(expandPath, 500);
    }
  }, [selectedConcept, treeData, tree]);

  return (
    <div className="space-y-1">
      <div 
        className="flex items-center gap-2 p-2 bg-muted/30 rounded-md mb-4 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => {
          if (onShowKnowledgeGraph) {
            onShowKnowledgeGraph();
          }
        }}
      >
        <Network className="h-4 w-4 text-blue-600" />
        <span className="font-medium">{t('common:labels.conceptGraph')}</span>
        <Badge variant="secondary" className="text-xs">
          {treeData.conceptMap.size} concepts
        </Badge>
      </div>
      
      <div {...tree.getContainerProps()} className="space-y-1" key={treeData.conceptMap.size}>
        {tree.getItems().map((item) => {
          // Skip rendering the root item
          if (item.getId() === 'root') {
            return null;
          }
          
          return (
            <ConceptTreeItem
              key={item.getId()}
              item={item}
              selectedConcept={selectedConcept}
              onSelectConcept={onSelectConcept}
            />
          );
        })}
        
        {tree.getItems().filter(item => item.getId() !== 'root').length === 0 && (
          <div className="text-center text-muted-foreground py-4">
            No concepts found
          </div>
        )}
      </div>
    </div>
  );
};

// Note: TaxonomyGroup component is kept for potential future use but not currently used in the main UI
// The UnifiedConceptTree now handles all concept display
// Deprecated: TaxonomyGroupProps unused after removing TaxonomyGroup

// Deprecated: TaxonomyGroup is currently unused and removed to avoid lints

interface ConceptDetailsProps {
  concept: OntologyConcept;
  concepts: OntologyConcept[];
  onSelectConcept: (concept: OntologyConcept) => void;
}

const ConceptDetails: React.FC<ConceptDetailsProps> = ({ concept, concepts, onSelectConcept }) => {
  const { t } = useTranslation(['semantic-models', 'common']);
  const navigate = useNavigate();
  
  // Helper function to resolve IRI to concept label
  const getConceptLabel = (iri: string): string => {
    const foundConcept = concepts.find(c => c.iri === iri);
    return foundConcept?.label || iri.split(/[/#]/).pop() || iri;
  };
  const DetailItem: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div className="mb-4">
      <div className="text-sm text-muted-foreground mb-1">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Details</h3>
      
      <DetailItem 
        label="IRI" 
        value={
          <div className="flex items-center gap-2">
            <code className="text-xs bg-muted p-1 rounded break-all">
              {concept.iri}
            </code>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 shrink-0"
              onClick={() => navigate(`/search/concepts?iri=${encodeURIComponent(concept.iri)}`)}
              title={t('common:tooltips.openInConceptSearch')}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        } 
      />
      
      <DetailItem 
        label="Type" 
        value={<Badge variant="outline">{concept.concept_type}</Badge>} 
      />
      
      <DetailItem 
        label="Source Taxonomy" 
        value={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {concept.source_context}
            </Badge>
            <span className="text-xs text-muted-foreground">
              ({concept.concept_type})
            </span>
          </div>
        } 
      />
      
      {concept.comment && (
        <DetailItem label="Description" value={concept.comment} />
      )}
      
      {concept.parent_concepts.length > 0 && (
        <DetailItem 
          label="Parent Concepts" 
          value={
            <div className="flex flex-wrap gap-2">
              {concept.parent_concepts.map(parentIri => {
                const parentConcept = concepts.find(c => c.iri === parentIri);
                return (
                  <Badge 
                    key={parentIri} 
                    variant="secondary" 
                    className="text-xs cursor-pointer hover:bg-secondary/80 transition-colors"
                    onClick={() => {
                      if (parentConcept) {
                        onSelectConcept(parentConcept);
                      }
                    }}
                  >
                    {getConceptLabel(parentIri)}
                  </Badge>
                );
              })}
            </div>
          } 
        />
      )}
      
      {concept.child_concepts.length > 0 && (
        <DetailItem 
          label="Child Concepts" 
          value={
            <div className="flex flex-wrap gap-2">
              {concept.child_concepts.map(childIri => {
                const childConcept = concepts.find(c => c.iri === childIri);
                return (
                  <Badge 
                    key={childIri} 
                    variant="outline" 
                    className="text-xs cursor-pointer hover:bg-accent/80 transition-colors"
                    onClick={() => {
                      if (childConcept) {
                        onSelectConcept(childConcept);
                      }
                    }}
                  >
                    {getConceptLabel(childIri)}
                  </Badge>
                );
              })}
            </div>
          } 
        />
      )}
    </div>
  );
};

// Deprecated: ConceptHierarchyView is unused and removed to avoid lints

interface TaggedAssetsViewProps {
  concept: OntologyConcept;
}

// Define the asset type for better type safety
type TaggedAsset = {
  id: string;
  name: string;
  type?: string;
  path?: string;
};

const TaggedAssetsView: React.FC<TaggedAssetsViewProps> = ({ concept }) => {
  // Define columns for the data table
  const columns: ColumnDef<TaggedAsset>[] = [
    {
      accessorKey: "name",
      header: "Asset Name",
      cell: ({ row }) => (
        <div className="font-medium">{row.getValue("name")}</div>
      ),
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => {
        const type = row.getValue("type") as string;
        return (
          <Badge variant="outline" className="text-xs">
            {type?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown'}
          </Badge>
        );
      },
      filterFn: (row, id, value) => {
        return value === 'all' || row.getValue(id) === value;
      },
    },
    {
      accessorKey: "path",
      header: "Path",
      cell: ({ row }) => {
        const path = row.getValue("path") as string;
        return path ? (
          <code className="text-sm text-muted-foreground bg-muted px-2 py-1 rounded">
            {path}
          </code>
        ) : null;
      },
    },
  ];

  if (concept.tagged_assets.length === 0) {
    return <div className="text-muted-foreground">No tagged assets found</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Tagged Assets</h3>
        <Badge variant="secondary" className="text-xs">
          {concept.tagged_assets.length} total
        </Badge>
      </div>

      <DataTable
        columns={columns}
        data={concept.tagged_assets}
        searchColumn="name"
      />
    </div>
  );
};

export default function SemanticModelsView() {
  const { t } = useTranslation(['semantic-models', 'common', 'search']);
  const [searchParams, setSearchParams] = useSearchParams();
  const { get, post } = useApi();
  const { toast } = useToast();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const [taxonomies, setTaxonomies] = useState<SemanticModel[]>([]);
  const [groupedConcepts, setGroupedConcepts] = useState<GroupedConcepts>({});
  const [selectedConcept, setSelectedConcept] = useState<OntologyConcept | null>(null);
  const [selectedHierarchy, setSelectedHierarchy] = useState<ConceptHierarchy | null>(null);
  // Removed unused treeExpandedIds state

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fetchInProgressRef = useRef(false);
  // Tabs removed; show sections in a single view
  const [stats, setStats] = useState<TaxonomyStats | null>(null);
  const [showKnowledgeGraph, setShowKnowledgeGraph] = useState(false);
  const [hiddenRoots, setHiddenRoots] = useState<Set<string>>(new Set());
  // const [graphExpanded, setGraphExpanded] = useState<Set<string>>(new Set());

  // Link Object dialog state
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [selectedEntityType, setSelectedEntityType] = useState<string>('');
  const [selectedEntityId, setSelectedEntityId] = useState<string>('');
  const [availableEntities, setAvailableEntities] = useState<any[]>([]);

  // Legacy form state removed - Phase 0 (read-only ontologies)

  const setStaticSegments = useBreadcrumbStore((state) => state.setStaticSegments);
  const setDynamicTitle = useBreadcrumbStore((state) => state.setDynamicTitle);

  // Glossary preferences from persistent store
  const glossaryPrefs = useGlossaryPreferencesStore();
  const { 
    hiddenSources, 
    groupBySource, 
    isFilterExpanded,
    toggleSource, 
    selectAllSources, 
    selectNoneSources, 
    setGroupBySource,
    setFilterExpanded
  } = glossaryPrefs;

  // Extract unique source contexts from concepts
  const availableSources = useMemo(() => {
    const allConcepts = Object.values(groupedConcepts).flat();
    const sources = new Set<string>();
    allConcepts.forEach((concept) => {
      if (concept.source_context) {
        sources.add(concept.source_context);
      }
    });
    return Array.from(sources).sort();
  }, [groupedConcepts]);

  // Filter concepts based on hidden sources
  const filteredConcepts = useMemo(() => {
    const allConcepts = Object.values(groupedConcepts).flat();
    if (hiddenSources.length === 0) {
      return allConcepts;
    }
    return allConcepts.filter(
      (concept) => !concept.source_context || !hiddenSources.includes(concept.source_context)
    );
  }, [groupedConcepts, hiddenSources]);

  // Permission check for write access
  const canWrite = !permissionsLoading && hasPermission('semantic-models', FeatureAccessLevel.READ_WRITE);

  useEffect(() => {
    fetchData();
    
    // Set breadcrumbs
    setStaticSegments([]);
    setDynamicTitle(t('semantic-models:title'));

    // Cleanup breadcrumbs and search timeout on unmount
    return () => {
      setStaticSegments([]);
      setDynamicTitle(null);
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []); // Empty dependency array to run only once on mount

  // Handle URL parameters to select concept on load or URL change
  useEffect(() => {
    const conceptParam = searchParams.get('concept');
    if (conceptParam && Object.keys(groupedConcepts).length > 0) {
      const decodedIri = decodeURIComponent(conceptParam);
      const allConcepts = Object.values(groupedConcepts).flat();
      const conceptToSelect = allConcepts.find(c => c.iri === decodedIri);
      
      if (conceptToSelect && conceptToSelect.iri !== selectedConcept?.iri) {
        // Use a timeout to avoid updating state during render
        setTimeout(() => {
          handleSelectConcept(conceptToSelect);
        }, 0);
      }
    } else if (!conceptParam && selectedConcept) {
      // Clear selection if no concept in URL
      setSelectedConcept(null);
      setSelectedHierarchy(null);
      setShowKnowledgeGraph(false);
    }
  }, [searchParams, groupedConcepts]); // React to changes in URL params and loaded concepts

  const fetchData = async () => {
    // Prevent duplicate fetches
    if (fetchInProgressRef.current) {
      return;
    }

    try {
      fetchInProgressRef.current = true;
      setLoading(true);

      // Fetch all data in parallel for better performance
      const [taxonomiesResponse, conceptsResponse, statsResponse] = await Promise.all([
        fetch('/api/semantic-models'),
        fetch('/api/semantic-models/concepts-grouped'),
        fetch('/api/semantic-models/stats'),
      ]);

      if (!taxonomiesResponse.ok) throw new Error('Failed to fetch taxonomies');
      if (!conceptsResponse.ok) throw new Error('Failed to fetch concepts');

      const [taxonomiesData, conceptsData, statsData] = await Promise.all([
        taxonomiesResponse.json(),
        conceptsResponse.json(),
        statsResponse.ok ? statsResponse.json() : Promise.resolve({ stats: null }),
      ]);

      setTaxonomies(taxonomiesData.taxonomies || []);
      setGroupedConcepts(conceptsData.grouped_concepts || {});
      setStats(statsData.stats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
      fetchInProgressRef.current = false;
    }
  };

  const handleSelectConcept = async (concept: OntologyConcept) => {
    setSelectedConcept(concept);
    setShowKnowledgeGraph(false);
    
    // Update URL with the selected concept IRI
    const newParams = new URLSearchParams(searchParams);
    newParams.set('concept', encodeURIComponent(concept.iri));
    setSearchParams(newParams);
    
    // Fetch hierarchy information
    try {
      const response = await fetch(`/api/semantic-models/concepts/hierarchy?iri=${encodeURIComponent(concept.iri)}`);
      if (response.ok) {
        const data = await response.json();
        setSelectedHierarchy(data.hierarchy);
      }
    } catch (err) {
      console.error('Failed to fetch concept hierarchy:', err);
    }

    // Fetch semantic links (tagged assets)
    try {
      const response = await fetch(`/api/semantic-links/iri/${encodeURIComponent(concept.iri)}`);
      if (response.ok) {
        const semanticLinks: EntitySemanticLink[] = await response.json();
        
        // Update the concept with tagged assets
        const updatedConcept = {
          ...concept,
          tagged_assets: semanticLinks.map((link) => ({
            id: link.entity_id,
            name: link.label || link.entity_id, // Backend should now provide meaningful labels
            type: link.entity_type,
            path: link.entity_id, // Show full ID in path column for reference
            description: `${link.entity_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}: ${link.label || link.entity_id}`
          }))
        };
        setSelectedConcept(updatedConcept);
      }
    } catch (err) {
      console.error('Failed to fetch semantic links:', err);
    }
  };

  const handleShowKnowledgeGraph = () => {
    setShowKnowledgeGraph(true);
    setSelectedConcept(null);
    
    // Clear concept from URL
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('concept');
    setSearchParams(newParams);
  };

  const handleSearch = async (query?: string) => {
    const searchTerm = query !== undefined ? query : searchQuery;
    if (!searchTerm.trim()) {
      fetchData();
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(
        `/api/semantic-models/search?q=${encodeURIComponent(searchTerm)}`
      );
      if (!response.ok) throw new Error('Search failed');
      const data = await response.json();
      
      // Group search results by taxonomy
      const grouped: GroupedConcepts = {};
      data.results.forEach((result: any) => {
        const concept = result.concept;
        const source = concept.source_context || 'Unassigned';
        if (!grouped[source]) {
          grouped[source] = [];
        }
        grouped[source].push(concept);
      });
      
      setGroupedConcepts(grouped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  // Handler for toggling root visibility in the knowledge graph
  const handleToggleRoot = useCallback((rootIri: string) => {
    setHiddenRoots(prev => {
      const newSet = new Set(prev);
      if (newSet.has(rootIri)) {
        newSet.delete(rootIri);
      } else {
        newSet.add(rootIri);
      }
      return newSet;
    });
  }, []);

  // Load entities for the link dialog based on entity type
  const loadEntitiesForType = async (entityType: string) => {
    try {
      let endpoint = '';
      switch (entityType) {
        case 'data_product':
          endpoint = '/api/data-products';
          break;
        case 'data_contract':
          endpoint = '/api/data-contracts';
          break;
        case 'data_domain':
          endpoint = '/api/data-domains';
          break;
        default:
          return;
      }

      const res = await get<any[]>(endpoint);
      setAvailableEntities(res.data || []);
    } catch (error) {
      console.error('Error loading entities:', error);
      setAvailableEntities([]);
    }
  };

  // Handle entity type selection in link dialog
  const handleEntityTypeChange = (entityType: string) => {
    setSelectedEntityType(entityType);
    setSelectedEntityId('');
    loadEntitiesForType(entityType);
  };

  // Handle linking concept to object
  const handleLinkToObject = async () => {
    if (!selectedConcept || !selectedEntityType || !selectedEntityId) {
      toast({
        title: t('common:toast.error'),
        description: t('search:concepts.messages.assignError'),
        variant: 'destructive'
      });
      return;
    }

    try {
      const res = await post('/api/semantic-links/', {
        entity_id: selectedEntityId,
        entity_type: selectedEntityType,
        iri: selectedConcept.iri,
      });

      if (res.error) {
        throw new Error(res.error);
      }

      const entityTypeLabel = selectedEntityType === 'data_product' ? t('search:concepts.assignDialog.dataProduct') :
                              selectedEntityType === 'data_contract' ? t('search:concepts.assignDialog.dataContract') :
                              t('search:concepts.assignDialog.dataDomain');

      toast({
        title: t('common:toast.success'),
        description: t('search:concepts.messages.linkedSuccess', {
          label: selectedConcept.label || selectedConcept.iri,
          entityType: entityTypeLabel,
          entityId: selectedEntityId
        }),
      });

      setLinkDialogOpen(false);
      setSelectedEntityType('');
      setSelectedEntityId('');

      // Refresh tagged assets by re-selecting the concept
      await handleSelectConcept(selectedConcept);
    } catch (error: any) {
      toast({
        title: t('common:toast.error'),
        description: error.message || t('search:concepts.messages.assignFailed'),
        variant: 'destructive'
      });
    }
  };

  const renderLineage = (hierarchy: ConceptHierarchy, selectedConcept: OntologyConcept | null = null) => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const allConcepts = Object.values(groupedConcepts).flat();

    // Detect dark mode
    const isDarkMode = document.documentElement.classList.contains('dark');

    // Helper function to find concept by IRI or create a minimal concept object
    const findConceptByIri = (iri: string): OntologyConcept | null => {
      // First, check if it's the current concept
      if (hierarchy.concept.iri === iri) {
        return hierarchy.concept;
      }
      
      // Try to find in grouped concepts first
      const foundInGrouped = allConcepts.find(c => c.iri === iri);
      if (foundInGrouped) {
        return foundInGrouped;
      }
      
      // If not found, create a minimal concept object with the IRI
      // Extract label from IRI (last part after # or /)
      const label = iri.split(/[/#]/).pop() || iri;
      
      return {
        iri,
        label,
        concept_type: 'class', // Default to class
        parent_concepts: [],
        child_concepts: [],
        source_context: '', // Will be empty for missing concepts
        description: '',
        comment: '',
        status: 'published',
        owner: '',
        created_at: '',
        updated_at: ''
      } as OntologyConcept;
    };

    // Add current concept as center node
    const centerY = 250;
    nodes.push({
      id: hierarchy.concept.iri,
      data: {
        label: hierarchy.concept.label || hierarchy.concept.iri.split(/[/#]/).pop(),
        sourceContext: hierarchy.concept.source_context
      },
      position: { x: 400, y: centerY },
      type: 'default',
      style: {
        background: isDarkMode ? '#1e293b' : '#fff',
        color: isDarkMode ? '#f1f5f9' : '#0f172a',
        border: '2px solid #2563eb',
        borderRadius: '8px',
        padding: '12px',
        fontSize: '14px',
        fontWeight: 'bold',
        minWidth: '140px',
        textAlign: 'center'
      }
    });

    // Add ALL parent concepts (not just immediate ones)
    const allParentIris = [...new Set([...hierarchy.concept.parent_concepts, ...(hierarchy.parents || [])])]; 
    allParentIris.forEach((parentIri, index) => {
      const parent = findConceptByIri(parentIri);
      if (parent && parent.iri !== hierarchy.concept.iri) {
        const nodeId = parent.iri;
        nodes.push({
          id: nodeId,
          data: {
            label: parent.label || parent.iri.split(/[/#]/).pop(),
            sourceContext: parent.source_context
          },
          position: { x: 400 + (index - allParentIris.length / 2 + 0.5) * 160, y: centerY - 150 },
          style: {
            background: isDarkMode ? '#1e3a5f' : '#dbeafe',
            color: isDarkMode ? '#bfdbfe' : '#1e3a8a',
            border: `1px solid ${isDarkMode ? '#60a5fa' : '#3b82f6'}`,
            borderRadius: '6px',
            padding: '10px',
            fontSize: '12px',
            minWidth: '120px',
            textAlign: 'center'
          }
        });
        
        edges.push({
          id: `${nodeId}-${hierarchy.concept.iri}`,
          source: nodeId,
          target: hierarchy.concept.iri,
          type: 'smoothstep',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isDarkMode ? '#94a3b8' : '#64748b'
          },
          style: { stroke: isDarkMode ? '#94a3b8' : '#64748b' }
        });
      }
    });

    // Add ALL child concepts - use selectedConcept if available, fallback to hierarchy.concept
    const conceptForChildren = selectedConcept?.iri === hierarchy.concept.iri ? selectedConcept : hierarchy.concept;
    const allChildIris = [...new Set([...conceptForChildren.child_concepts, ...(hierarchy.children || [])])]; 
    
    allChildIris.forEach((childIri, index) => {
      const child = findConceptByIri(childIri);
      if (child && child.iri !== hierarchy.concept.iri) {
        const nodeId = child.iri;
        nodes.push({
          id: nodeId,
          data: {
            label: child.label || child.iri.split(/[/#]/).pop(),
            sourceContext: child.source_context
          },
          position: { x: 400 + (index - allChildIris.length / 2 + 0.5) * 160, y: centerY + 150 },
          style: {
            background: isDarkMode ? '#14532d' : '#dcfce7',
            color: isDarkMode ? '#bbf7d0' : '#15803d',
            border: `1px solid ${isDarkMode ? '#22c55e' : '#16a34a'}`,
            borderRadius: '6px',
            padding: '10px',
            fontSize: '12px',
            minWidth: '120px',
            textAlign: 'center'
          }
        });
        
        edges.push({
          id: `${hierarchy.concept.iri}-${nodeId}`,
          source: hierarchy.concept.iri,
          target: nodeId,
          type: 'smoothstep',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isDarkMode ? '#94a3b8' : '#64748b'
          },
          style: { stroke: isDarkMode ? '#94a3b8' : '#64748b' }
        });
      }
    });

    // Add siblings if available (dashed lines FROM selected concept TO siblings)
    if (hierarchy.siblings && hierarchy.siblings.length > 0) {
      hierarchy.siblings.forEach((sibling, index) => {
        // Don't add the selected concept as its own sibling
        if (sibling.iri === hierarchy.concept.iri) return;
        
        const nodeId = sibling.iri;
        nodes.push({
          id: nodeId,
          data: {
            label: sibling.label || sibling.iri.split(/[/#]/).pop(),
            sourceContext: sibling.source_context
          },
          position: { x: 700 + (index * 180), y: centerY },
          style: {
            background: isDarkMode ? '#334155' : '#f5f5f5',
            color: isDarkMode ? '#94a3b8' : '#9ca3af',
            border: `1px solid ${isDarkMode ? '#475569' : '#d1d5db'}`,
            borderRadius: '6px',
            padding: '10px',
            fontSize: '12px',
            minWidth: '120px',
            textAlign: 'center',
            opacity: 0.6
          }
        });
        
        // Find shared parent for sibling relationships
        const sharedParent = allParentIris.find(parentIri => 
          sibling.parent_concepts && sibling.parent_concepts.includes(parentIri)
        ) || allParentIris[0]; // Fallback to first parent if no shared parent found
        
        if (sharedParent) {
          // Add muted connecting line FROM shared parent TO sibling
          edges.push({
            id: `${sharedParent}-sibling-${nodeId}`,
            source: sharedParent,
            target: nodeId,
            type: 'smoothstep',
            style: {
              stroke: isDarkMode ? '#475569' : '#d1d5db',
              strokeWidth: 1,
              opacity: 0.5,
              strokeDasharray: '5,5'
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: isDarkMode ? '#475569' : '#d1d5db'
            }
          });
        }
      });
    }

    return (
      <div className="h-[500px] border rounded-lg">
        <style>
          {`
            .react-flow__handle {
              opacity: 0 !important;
              pointer-events: none !important;
              width: 1px !important;
              height: 1px !important;
            }
            .react-flow__node {
              cursor: pointer;
            }
            .react-flow__node:hover {
              transform: scale(1.05);
              transition: transform 0.2s ease;
            }
          `}
        </style>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          onInit={(reactFlowInstance) => {
            // Enhanced fit view on initialization
            setTimeout(() => {
              reactFlowInstance.fitView({ 
                padding: 0.15,
                includeHiddenNodes: false,
                minZoom: 0.5,
                maxZoom: 1.2
              });
            }, 100);
          }}
          minZoom={0.5}
          maxZoom={1.5}
          className="bg-background"
          defaultEdgeOptions={{
            style: {
              strokeWidth: 1.5,
              stroke: isDarkMode ? '#94a3b8' : '#64748b'
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: isDarkMode ? '#94a3b8' : '#64748b'
            }
          }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          onNodeClick={(_, node) => {
            // Find and select the concept in the tree
            const allConcepts = Object.values(groupedConcepts).flat();
            const concept = allConcepts.find(c => c.iri === node.id);
            if (concept) {
              handleSelectConcept(concept);
            }
          }}
          connectionMode={ConnectionMode.Strict}
        >
          <Controls />
          <Background color={isDarkMode ? '#334155' : '#e2e8f0'} gap={16} />
        </ReactFlow>
      </div>
    );
  };

  // Legacy create handlers removed - Phase 0 (read-only ontologies)

  // Removed early return to keep header visible while loading

  return (
    <div className="py-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold mb-6 flex items-center gap-2">
          <Network className="w-8 h-8" /> {t('semantic-models:title')}
        </h1>
        <div className="flex items-center gap-4">
          {stats && (
            <div className="text-sm text-muted-foreground">
              {stats.taxonomies.length} models / {stats.total_concepts + stats.total_properties} terms
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      ) : error ? (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : (
      <div className="grid grid-cols-12 gap-6">
        {/* Left Panel - Taxonomy Tree */}
        <div className="col-span-4 border rounded-lg flex flex-col">
          <div className="p-4 border-b">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type="text"
                  placeholder={t('common:placeholders.searchConceptsAndTerms')}
                  value={searchQuery}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSearchQuery(value);
                    // Debounced search as user types
                    if (searchTimeoutRef.current) {
                      clearTimeout(searchTimeoutRef.current);
                    }
                    searchTimeoutRef.current = setTimeout(() => {
                      handleSearch(value);
                    }, 300);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (searchTimeoutRef.current) {
                        clearTimeout(searchTimeoutRef.current);
                      }
                      handleSearch();
                    } else if (e.key === 'Escape') {
                      setSearchQuery('');
                      if (searchTimeoutRef.current) {
                        clearTimeout(searchTimeoutRef.current);
                      }
                      handleSearch('');
                    }
                  }}
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                    onClick={() => {
                      setSearchQuery('');
                      if (searchTimeoutRef.current) {
                        clearTimeout(searchTimeoutRef.current);
                      }
                      handleSearch('');
                    }}
                  >
                    ×
                  </Button>
                )}
              </div>
              <Button onClick={() => handleSearch()} size="sm">
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {/* Filter by Source - Collapsible */}
          {availableSources.length > 0 && (
            <Collapsible
              open={isFilterExpanded}
              onOpenChange={setFilterExpanded}
              className="border-b"
            >
              <div className="px-4 py-2 flex items-center justify-between">
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors">
                    {isFilterExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <Filter className="h-4 w-4" />
                    {t('semantic-models:filters.bySource')}
                    {hiddenSources.length > 0 && (
                      <Badge variant="secondary" className="h-5 text-[10px] px-1.5">
                        {availableSources.length - hiddenSources.length}/{availableSources.length}
                      </Badge>
                    )}
                  </button>
                </CollapsibleTrigger>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={selectAllSources}
                  >
                    {t('semantic-models:filters.all')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => selectNoneSources(availableSources)}
                  >
                    {t('semantic-models:filters.none')}
                  </Button>
                </div>
              </div>
              <CollapsibleContent>
                <div className="px-4 pb-3 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {availableSources.map((source) => {
                      const isVisible = !hiddenSources.includes(source);
                      const conceptCount = Object.values(groupedConcepts)
                        .flat()
                        .filter((c) => c.source_context === source).length;
                      return (
                        <label
                          key={source}
                          className={cn(
                            "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs cursor-pointer transition-colors",
                            "border hover:bg-accent",
                            isVisible ? "bg-accent/50 border-primary/30" : "opacity-60"
                          )}
                        >
                          <Checkbox
                            checked={isVisible}
                            onCheckedChange={() => toggleSource(source)}
                            className="h-3.5 w-3.5"
                          />
                          <span>{source}</span>
                          <Badge variant="secondary" className="h-4 text-[10px] px-1">
                            {conceptCount}
                          </Badge>
                        </label>
                      );
                    })}
                  </div>
                  
                  {/* Group by Source Toggle */}
                  <div className="flex items-center justify-between pt-2 border-t">
                    <Label htmlFor="group-by-source" className="text-sm flex items-center gap-2 cursor-pointer">
                      <FolderTree className="h-4 w-4" />
                      {t('semantic-models:filters.groupBySource')}
                    </Label>
                    <Switch
                      id="group-by-source"
                      checked={groupBySource}
                      onCheckedChange={setGroupBySource}
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
          
          <ScrollArea className="flex-1">
            <div className="p-4 h-full">
              <UnifiedConceptTree
                key={`${filteredConcepts.length}-${groupBySource}`}
                concepts={filteredConcepts}
                selectedConcept={selectedConcept}
                onSelectConcept={handleSelectConcept}
                onShowKnowledgeGraph={handleShowKnowledgeGraph}
                searchQuery={searchQuery}
                groupBySource={groupBySource}
              />
            </div>
          </ScrollArea>
        </div>

        {/* Right Panel - Concept Details or Knowledge Graph */}
        <div className="col-span-8 border rounded-lg">
          {showKnowledgeGraph ? (
            <div className="h-full min-h-[1100px] flex flex-col">
              <div className="p-6 border-b">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-2xl font-semibold mb-2 flex items-center gap-2">
                      <Network className="h-6 w-6" />
                      Concept Graph
                    </h2>
                    <p className="text-muted-foreground">
                      Interactive visualization of all concepts and their relationships. Click legend items to toggle visibility.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex-1 min-h-[900px]">
                <KnowledgeGraph
                  concepts={filteredConcepts}
                  hiddenRoots={hiddenRoots}
                  onToggleRoot={handleToggleRoot}
                  onNodeClick={handleSelectConcept}
                  showRootBadges={!groupBySource}
                />
              </div>
            </div>
          ) : selectedConcept ? (
            <div className="h-full">
              <div className="p-6 border-b">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-2xl font-semibold mb-2 flex items-center gap-2">
                      {(() => {
                        switch (selectedConcept.concept_type) {
                          case 'class':
                            return <Layers className="h-6 w-6 shrink-0 text-blue-500" />;
                          case 'concept':
                            return <Layers className="h-6 w-6 shrink-0 text-green-500" />;
                          default:
                            return <Zap className="h-6 w-6 shrink-0 text-yellow-500" />;
                        }
                      })()}
                      {selectedConcept.label || selectedConcept.iri.split(/[/#]/).pop()}
                    </h2>
                    <p className="text-muted-foreground">
                      {selectedConcept.comment || 'No description available'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Details Section */}
                <div className="border rounded-lg p-4">
                  <ConceptDetails 
                    concept={selectedConcept} 
                    concepts={Object.values(groupedConcepts).flat()}
                    onSelectConcept={handleSelectConcept}
                  />
                </div>

                {/* Hierarchy Section */}
                <div className="border rounded-lg p-4">
                  {selectedHierarchy ? (
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold">Concept Hierarchy</h3>
                      {renderLineage(selectedHierarchy, selectedConcept)}
                    </div>
                  ) : (
                    <div className="text-muted-foreground">{t('common:labels.loadingHierarchy')}</div>
                  )}
                </div>

                {/* Tagged Assets Section */}
                <div className="border rounded-lg p-4">
                  <TaggedAssetsView concept={selectedConcept} />
                  
                  {/* Link Object Button - only visible with write access */}
                  {canWrite && (
                    <div className="pt-4 mt-4 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setLinkDialogOpen(true)}
                        disabled={!selectedConcept}
                      >
                        <Link2 className="h-4 w-4 mr-2" />
                        {t('search:concepts.assignToConcept')}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Network className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Select a concept or click Concept Graph to view details</p>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Link Object Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('search:concepts.assignDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {selectedConcept && (
              <div className="text-sm">
                <p className="font-medium">{selectedConcept.label || selectedConcept.iri.split(/[/#]/).pop()}</p>
                <p className="text-muted-foreground font-mono text-xs">{selectedConcept.iri}</p>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('search:concepts.assignDialog.entityType')}</label>
              <Select value={selectedEntityType} onValueChange={handleEntityTypeChange}>
                <SelectTrigger>
                  <SelectValue placeholder={t('search:concepts.assignDialog.selectEntityType')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="data_product">{t('search:concepts.assignDialog.dataProduct')}</SelectItem>
                  <SelectItem value="data_contract">{t('search:concepts.assignDialog.dataContract')}</SelectItem>
                  <SelectItem value="data_domain">{t('search:concepts.assignDialog.dataDomain')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {selectedEntityType && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {selectedEntityType === 'data_product' ? t('search:concepts.assignDialog.dataProduct') :
                   selectedEntityType === 'data_contract' ? t('search:concepts.assignDialog.dataContract') :
                   t('search:concepts.assignDialog.dataDomain')}
                </label>
                <Select value={selectedEntityId} onValueChange={setSelectedEntityId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('search:concepts.assignDialog.selectEntity', { 
                      entityType: selectedEntityType === 'data_product' ? t('search:concepts.assignDialog.dataProduct') :
                                  selectedEntityType === 'data_contract' ? t('search:concepts.assignDialog.dataContract') :
                                  t('search:concepts.assignDialog.dataDomain')
                    })} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableEntities.map((entity) => (
                      <SelectItem key={entity.id} value={entity.id}>
                        {entity.name || entity.info?.title || entity.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-4">
              <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button
                onClick={handleLinkToObject}
                disabled={!selectedEntityType || !selectedEntityId}
              >
                {t('common:actions.assign')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}