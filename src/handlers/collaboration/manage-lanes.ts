import { type ToolResult } from '../../types';
import { validateArgs } from '../helpers';
import { handleAnalyzeLanes } from './analyze-lanes';
import { handleAssignElementsToLane } from './assign-elements-to-lane';

export interface ManageBpmnLanesArgs {
  diagramId: string;
  mode: 'assign' | 'suggest' | 'validate' | 'pool-vs-lanes' | 'redistribute';
  participantId?: string;
  laneId?: string;
  elementIds?: string[];
  reposition?: boolean;
  strategy?: string;
  dryRun?: boolean;
  validate?: boolean;
}

export async function handleManageBpmnLanes(args: ManageBpmnLanesArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'mode']);

  if (args.mode === 'assign') {
    validateArgs(args, ['laneId', 'elementIds']);
    return handleAssignElementsToLane({
      diagramId: args.diagramId,
      laneId: args.laneId!,
      elementIds: args.elementIds!,
      ...(args.reposition !== undefined ? { reposition: args.reposition } : {}),
    });
  }

  return handleAnalyzeLanes({
    diagramId: args.diagramId,
    mode: args.mode,
    ...(args.participantId ? { participantId: args.participantId } : {}),
    ...(args.strategy ? { strategy: args.strategy } : {}),
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
    ...(args.validate !== undefined ? { validate: args.validate } : {}),
    ...(args.reposition !== undefined ? { reposition: args.reposition } : {}),
  });
}

export const TOOL_DEFINITION = {
  name: 'manage_bpmn_lanes',
  description:
    'Unified lane-management interface for BPMN swimlanes. ' +
    'Use mode=assign to place elements into a lane, mode=suggest to get lane suggestions, mode=validate to assess current lane organization, ' +
    'mode=pool-vs-lanes to choose between collaboration pools and lanes, and mode=redistribute to rebalance elements across existing lanes.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID.' },
      mode: {
        type: 'string',
        enum: ['assign', 'suggest', 'validate', 'pool-vs-lanes', 'redistribute'],
        description: 'Lane-management mode.',
      },
      participantId: {
        type: 'string',
        description: 'Optional participant ID used by suggest, validate, and redistribute modes.',
      },
      laneId: {
        type: 'string',
        description: 'Target lane ID for mode=assign.',
      },
      elementIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: 'Element IDs for mode=assign.',
      },
      reposition: {
        type: 'boolean',
        description: 'Whether to reposition assigned or redistributed elements within lane bounds.',
      },
      strategy: {
        type: 'string',
        enum: ['role-based', 'balance', 'minimize-crossings', 'manual'],
        description: 'Redistribution strategy for mode=redistribute.',
      },
      dryRun: {
        type: 'boolean',
        description: 'When true for mode=redistribute, preview the redistribution without applying changes.',
      },
      validate: {
        type: 'boolean',
        description: 'When true for mode=redistribute, validate before and after redistribution.',
      },
    },
    required: ['diagramId', 'mode'],
  },
} as const;