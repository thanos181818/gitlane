import React, { useState, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
  TouchableWithoutFeedback,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Filter, GitBranch, GitMerge } from 'lucide-react-native';
import Svg, { Line, Circle as SvgCircle, Rect } from 'react-native-svg';
import Colors from '@/constants/colors';
import { Spacing, Radius } from '@/constants/theme';
import { useGit } from '@/contexts/GitContext';
import { getAuthorColor, getAuthorInitials } from '@/mocks/repositories';

const COLUMN_WIDTH = 40;
const ROW_HEIGHT = 80;
const NODE_RADIUS = 8;
const HEAD_RADIUS = 10;

export default function GraphScreen() {
  const insets = useSafeAreaInsets();
  const { commits, repositories } = useGit();
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const selectedRepo = repositories[0];

  const graphData = useMemo(() => {
    const commitMap = new Map<string, typeof commits[0]>();
    commits.forEach(c => commitMap.set(c.sha, c));

    const shaToColumn = new Map<string, number>();
    const activeColumns: (string | null)[] = [];

    const nodes = commits.map((commit, index) => {
      const sha = commit.sha;

      let col = activeColumns.indexOf(sha);
      if (col === -1) {
        col = activeColumns.indexOf(null);
        if (col === -1) {
          col = activeColumns.length;
          activeColumns.push(sha);
        } else {
          activeColumns[col] = sha;
        }
      }

      shaToColumn.set(sha, col);

      if (commit.parents && commit.parents.length > 0) {
        const primaryParent = commit.parents[0];
        activeColumns[col] = primaryParent;

        for (let pIdx = 1; pIdx < commit.parents.length; pIdx++) {
          const parentSha = commit.parents[pIdx];
          if (activeColumns.indexOf(parentSha) === -1) {
            const freeSlot = activeColumns.indexOf(null);
            if (freeSlot === -1) {
              activeColumns.push(parentSha);
            } else {
              activeColumns[freeSlot] = parentSha;
            }
          }
        }
      } else {
        activeColumns[col] = null;
      }

      return {
        commit,
        sha,
        x: 30 + col * COLUMN_WIDTH,
        y: 40 + index * ROW_HEIGHT,
        col,
        color: getAuthorColor(commit.author),
        isHead: commit.branches.includes('HEAD') || commit.branches.includes('main') || commit.branches.includes('master'),
        isMerge: commit.isMerge || (commit.parents && commit.parents.length > 1),
      };
    });

    const nodeMap = new Map<string, typeof nodes[0]>();
    nodes.forEach(n => nodeMap.set(n.sha, n));

    const edges: Array<{
      id: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      isMerge: boolean;
    }> = [];

    nodes.forEach(node => {
      if (node.commit.parents) {
        node.commit.parents.forEach((parentSha, pIdx) => {
          const parentNode = nodeMap.get(parentSha);
          if (parentNode) {
            edges.push({
              id: `edge-${node.sha}-${parentSha}`,
              x1: node.x,
              y1: node.y,
              x2: parentNode.x,
              y2: parentNode.y,
              isMerge: pIdx > 0,
            });
          } else {
            edges.push({
              id: `edge-${node.sha}-truncated-${pIdx}`,
              x1: node.x,
              y1: node.y,
              x2: node.x,
              y2: node.y + ROW_HEIGHT,
              isMerge: pIdx > 0,
            });
          }
        });
      }
    });

    return { nodes, edges };
  }, [commits]);

  const svgHeight = graphData.nodes.length * ROW_HEIGHT + 80;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Commit Graph</Text>
          {selectedRepo && (
            <Text style={styles.headerSubtitle}>{selectedRepo.name}</Text>
          )}
        </View>
        <TouchableOpacity style={styles.filterBtn}>
          <Filter size={20} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.graphContainer}>
          <Svg width={120} height={svgHeight} style={styles.svg}>
            {/* Draw parent-child edges */}
            {graphData.edges.map((edge) => (
              <Line
                key={edge.id}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke={edge.isMerge ? Colors.accentPurple : Colors.textMuted}
                strokeWidth={2}
                strokeDasharray={edge.isMerge ? '6,3' : undefined}
                opacity={0.5}
              />
            ))}

            {/* Draw commit nodes */}
            {graphData.nodes.map((node) => (
              <React.Fragment key={node.sha}>
                {node.isHead && (
                  <SvgCircle
                    cx={node.x}
                    cy={node.y}
                    r={HEAD_RADIUS + 4}
                    fill="none"
                    stroke={Colors.accentPrimary}
                    strokeWidth={2}
                    opacity={0.4}
                  />
                )}
                {node.isMerge ? (
                  <Rect
                    x={node.x - 7}
                    y={node.y - 7}
                    width={14}
                    height={14}
                    fill={node.color}
                    rx={2}
                    transform={`rotate(45, ${node.x}, ${node.y})`}
                  />
                ) : (
                  <SvgCircle
                    cx={node.x}
                    cy={node.y}
                    r={node.isHead ? HEAD_RADIUS : NODE_RADIUS}
                    fill={node.color}
                    stroke={node.isHead ? Colors.accentPrimary : 'transparent'}
                    strokeWidth={node.isHead ? 3 : 0}
                  />
                )}
              </React.Fragment>
            ))}
          </Svg>

          <View style={styles.commitList}>
            {graphData.nodes.map((node) => (
              <TouchableOpacity
                key={node.sha}
                style={[
                  styles.commitRow,
                  selectedSha === node.sha && styles.commitRowSelected,
                ]}
                onPress={() => setSelectedSha(
                  selectedSha === node.sha ? null : node.sha
                )}
                activeOpacity={0.7}
              >
                <View style={styles.commitContent}>
                  <Text style={styles.commitMessage} numberOfLines={1}>
                    {node.commit.message}
                  </Text>
                  <View style={styles.commitMeta}>
                    <View style={[styles.authorDot, { backgroundColor: node.color }]}>
                      <Text style={styles.authorInitials}>
                        {getAuthorInitials(node.commit.author)}
                      </Text>
                    </View>
                    <Text style={styles.commitAuthor}>{node.commit.author}</Text>
                    <Text style={styles.commitTime}>{node.commit.date}</Text>
                  </View>
                  <View style={styles.commitTags}>
                    {node.commit.branches.filter((b: string) => b !== 'HEAD').map((branch: string) => (
                      <View key={branch} style={styles.branchTag}>
                        <GitBranch size={10} color={Colors.accentPrimary} />
                        <Text style={styles.branchTagText}>{branch}</Text>
                      </View>
                    ))}
                    {node.isMerge && (
                      <View style={[styles.branchTag, { backgroundColor: 'rgba(168,85,247,0.15)' }]}>
                        <GitMerge size={10} color={Colors.accentPurple} />
                        <Text style={[styles.branchTagText, { color: Colors.accentPurple }]}>merge</Text>
                      </View>
                    )}
                    <Text style={styles.shaText}>{node.commit.shortSha}</Text>
                  </View>
                </View>

                {selectedSha === node.sha && (
                  <View style={styles.tooltip}>
                    <Text style={styles.tooltipTitle}>{node.commit.message}</Text>
                    <Text style={styles.tooltipMeta}>
                      {node.commit.filesChanged} files · +{node.commit.additions} −{node.commit.deletions}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
            <View style={{ height: 120 }} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgPrimary,
  },
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.bgSecondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderDefault,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '600' as const,
    color: Colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 1,
  },
  filterBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    backgroundColor: Colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  graphContainer: {
    flexDirection: 'row',
  },
  svg: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  commitList: {
    flex: 1,
    paddingLeft: 120,
    paddingRight: Spacing.md,
  },
  commitRow: {
    height: ROW_HEIGHT,
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderMuted,
  },
  commitRowSelected: {
    backgroundColor: Colors.bgSecondary,
    borderRadius: Radius.sm,
    marginHorizontal: -Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  commitContent: {},
  commitMessage: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  commitMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  authorDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authorInitials: {
    fontSize: 8,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  commitAuthor: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  commitTime: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  commitTags: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  branchTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.accentPrimaryDim,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  branchTagText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.accentPrimary,
  },
  shaText: {
    fontSize: 11,
    color: Colors.textMuted,
    fontFamily: 'monospace',
  },
  tooltip: {
    backgroundColor: Colors.bgElevated,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    marginTop: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.borderDefault,
  },
  tooltipTitle: {
    fontSize: 13,
    color: Colors.textPrimary,
    fontWeight: '500' as const,
    marginBottom: 2,
  },
  tooltipMeta: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
});
