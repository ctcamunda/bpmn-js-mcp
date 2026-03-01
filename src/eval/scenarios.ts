import {
  handleAddElement,
  handleConnect,
  handleCreateDiagram,
  handleCreateLanes,
  handleLayoutDiagram,
  handleSetProperties,
  handleSetEventDefinition,
} from '../handlers';
import { clearDiagrams } from '../diagram-manager';
import { parseToolJson } from './mcp-json';

export interface EvalScenario {
  scenarioId: string;
  name: string;
  build: () => Promise<{ diagramId: string }>;
}

async function createDiagram(name: string): Promise<string> {
  const created = parseToolJson<{ success: boolean; diagramId: string }>(
    await handleCreateDiagram({ name })
  );
  return created.diagramId;
}

async function add(
  diagramId: string,
  elementType: string,
  name?: string,
  extra?: Record<string, any>
) {
  const res = parseToolJson<{ success: boolean; elementId: string }>(
    await handleAddElement({ diagramId, elementType, name, ...extra })
  );
  return res.elementId;
}

async function connect(
  diagramId: string,
  sourceElementId: string,
  targetElementId: string,
  extra?: Record<string, any>
) {
  await handleConnect({ diagramId, sourceElementId, targetElementId, ...extra });
}

async function setProps(diagramId: string, elementId: string, properties: Record<string, any>) {
  await handleSetProperties({ diagramId, elementId, properties });
}

async function setEventDef(
  diagramId: string,
  elementId: string,
  eventDefinitionType: string,
  properties?: Record<string, any>
) {
  await handleSetEventDefinition({ diagramId, elementId, eventDefinitionType, properties });
}

async function layout(diagramId: string) {
  await handleLayoutDiagram({ diagramId });
}

const START_EVENT = 'bpmn:StartEvent';
const END_EVENT = 'bpmn:EndEvent';
const USER_TASK = 'bpmn:UserTask';
const SERVICE_TASK = 'bpmn:ServiceTask';
const EXCLUSIVE_GATEWAY = 'bpmn:ExclusiveGateway';
const PARALLEL_GATEWAY = 'bpmn:ParallelGateway';
const PARTICIPANT = 'bpmn:Participant';
const BOUNDARY_EVENT = 'bpmn:BoundaryEvent';

function s01Linear(): EvalScenario {
  return {
    scenarioId: 'S01',
    name: 'Linear flow (5 elements)',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S01 Linear');
      const start = await add(diagramId, START_EVENT, 'Start');
      const t1 = await add(diagramId, USER_TASK, 'Collect Info', { afterElementId: start });
      const t2 = await add(diagramId, SERVICE_TASK, 'Validate', { afterElementId: t1 });
      const t3 = await add(diagramId, USER_TASK, 'Approve', { afterElementId: t2 });
      const end = await add(diagramId, END_EVENT, 'Done', { afterElementId: t3 });

      await connect(diagramId, start, t1);
      await connect(diagramId, t1, t2);
      await connect(diagramId, t2, t3);
      await connect(diagramId, t3, end);

      await layout(diagramId);
      return { diagramId };
    },
  };
}

function s02Exclusive(): EvalScenario {
  return {
    scenarioId: 'S02',
    name: 'Exclusive gateway (split/merge)',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S02 Exclusive');
      const start = await add(diagramId, START_EVENT, 'Start');
      const gw = await add(diagramId, EXCLUSIVE_GATEWAY, 'Decision', { afterElementId: start });
      const yes = await add(diagramId, USER_TASK, 'Yes Path', { afterElementId: gw });
      const no = await add(diagramId, USER_TASK, 'No Path', { afterElementId: gw });
      const merge = await add(diagramId, EXCLUSIVE_GATEWAY, 'Merge', { afterElementId: yes });
      const end = await add(diagramId, END_EVENT, 'Done', { afterElementId: merge });

      await connect(diagramId, start, gw);
      await connect(diagramId, gw, yes, {
        label: 'Yes',
        conditionExpression: '${approved == true}',
      });
      await connect(diagramId, gw, no, { label: 'No', isDefault: true });
      await connect(diagramId, yes, merge);
      await connect(diagramId, no, merge);
      await connect(diagramId, merge, end);

      await layout(diagramId);
      return { diagramId };
    },
  };
}

function s03Parallel(): EvalScenario {
  return {
    scenarioId: 'S03',
    name: 'Parallel gateway (fork/join, 3 branches)',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S03 Parallel');
      const start = await add(diagramId, START_EVENT, 'Start');
      const split = await add(diagramId, PARALLEL_GATEWAY, 'Split', { afterElementId: start });
      const b1 = await add(diagramId, USER_TASK, 'Branch 1', { afterElementId: split });
      const b2 = await add(diagramId, SERVICE_TASK, 'Branch 2', { afterElementId: split });
      const b3 = await add(diagramId, USER_TASK, 'Branch 3', { afterElementId: split });
      const join = await add(diagramId, PARALLEL_GATEWAY, 'Join', { afterElementId: b1 });
      const end = await add(diagramId, END_EVENT, 'Done', { afterElementId: join });

      await connect(diagramId, start, split);
      await connect(diagramId, split, b1);
      await connect(diagramId, split, b2);
      await connect(diagramId, split, b3);
      await connect(diagramId, b1, join);
      await connect(diagramId, b2, join);
      await connect(diagramId, b3, join);
      await connect(diagramId, join, end);

      await layout(diagramId);
      return { diagramId };
    },
  };
}

function s06Lanes(): EvalScenario {
  return {
    scenarioId: 'S06',
    name: 'Two lanes with cross-lane flow',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S06 Lanes');
      const participant = await add(diagramId, PARTICIPANT, 'Two Lane Process', { x: 400, y: 300 });

      const lanes = parseToolJson<{ success: boolean; laneIds: string[] }>(
        await handleCreateLanes({
          diagramId,
          participantId: participant,
          lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
        })
      );
      const [laneA, laneB] = lanes.laneIds;

      const start = await add(diagramId, START_EVENT, 'Start', {
        participantId: participant,
        laneId: laneA,
      });
      const taskA = await add(diagramId, USER_TASK, 'Task A', {
        participantId: participant,
        laneId: laneA,
        afterElementId: start,
      });
      const taskB = await add(diagramId, USER_TASK, 'Task B', {
        participantId: participant,
        laneId: laneB,
        afterElementId: taskA,
      });
      const end = await add(diagramId, END_EVENT, 'Done', {
        participantId: participant,
        laneId: laneB,
        afterElementId: taskB,
      });

      await connect(diagramId, start, taskA);
      await connect(diagramId, taskA, taskB);
      await connect(diagramId, taskB, end);

      await layout(diagramId);
      return { diagramId };
    },
  };
}

export function getEvalScenarios(): EvalScenario[] {
  return [
    s01Linear(),
    s02Exclusive(),
    s03Parallel(),
    s04Camunda7Executable(),
    s05TimerBoundary(),
    s06Lanes(),
  ];
}

/**
 * S04: Camunda 7 executable process with proper implementations.
 *
 * Tests Camunda 7 executability requirements:
 * - Service task with external task topic
 * - User task with assignee
 * - Proper gateway conditions
 */
function s04Camunda7Executable(): EvalScenario {
  return {
    scenarioId: 'S04',
    name: 'Camunda 7 executable process',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S04 Camunda7');
      const start = await add(diagramId, START_EVENT, 'Order Received');
      const validate = await add(diagramId, SERVICE_TASK, 'Validate Order', {
        afterElementId: start,
      });
      // Set external task topic for Camunda 7
      await setProps(diagramId, validate, {
        'camunda:type': 'external',
        'camunda:topic': 'validate-order',
      });

      const review = await add(diagramId, USER_TASK, 'Review Order', { afterElementId: validate });
      // Set assignee for Camunda 7
      await setProps(diagramId, review, { 'camunda:assignee': 'sales-team' });

      const decision = await add(diagramId, EXCLUSIVE_GATEWAY, 'Approved?', {
        afterElementId: review,
      });
      const approve = await add(diagramId, SERVICE_TASK, 'Process Order', {
        afterElementId: decision,
      });
      await setProps(diagramId, approve, {
        'camunda:type': 'external',
        'camunda:topic': 'process-order',
      });

      const reject = await add(diagramId, SERVICE_TASK, 'Send Rejection', {
        afterElementId: decision,
      });
      await setProps(diagramId, reject, {
        'camunda:type': 'external',
        'camunda:topic': 'send-rejection',
      });

      const end = await add(diagramId, END_EVENT, 'Done', { afterElementId: approve });

      await connect(diagramId, start, validate);
      await connect(diagramId, validate, review);
      await connect(diagramId, review, decision);
      await connect(diagramId, decision, approve, {
        label: 'Yes',
        conditionExpression: '${approved == true}',
      });
      await connect(diagramId, decision, reject, { label: 'No', isDefault: true });
      await connect(diagramId, approve, end);
      await connect(diagramId, reject, end);

      await layout(diagramId);
      return { diagramId };
    },
  };
}

/**
 * S05: Timer boundary event with escalation path.
 *
 * Tests boundary event layout and timer configuration:
 * - Timer boundary event attached to user task
 * - Escalation path from timeout
 * - Proper timer definition (ISO 8601)
 */
function s05TimerBoundary(): EvalScenario {
  return {
    scenarioId: 'S05',
    name: 'Timer boundary event escalation',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S05 Timer');
      const start = await add(diagramId, START_EVENT, 'Start');
      const task = await add(diagramId, USER_TASK, 'Wait for Approval', { afterElementId: start });
      await setProps(diagramId, task, { 'camunda:assignee': 'manager' });

      // Add timer boundary event
      const timer = await add(diagramId, BOUNDARY_EVENT, 'Timeout', { hostElementId: task });
      await setEventDef(diagramId, timer, 'bpmn:TimerEventDefinition', { timeDuration: 'PT1H' });

      const normalEnd = await add(diagramId, END_EVENT, 'Approved', { afterElementId: task });
      const escalate = await add(diagramId, SERVICE_TASK, 'Escalate', { afterElementId: timer });
      await setProps(diagramId, escalate, {
        'camunda:type': 'external',
        'camunda:topic': 'escalate-approval',
      });
      const escalateEnd = await add(diagramId, END_EVENT, 'Escalated', {
        afterElementId: escalate,
      });

      await connect(diagramId, start, task);
      await connect(diagramId, task, normalEnd);
      await connect(diagramId, timer, escalate);
      await connect(diagramId, escalate, escalateEnd);

      await layout(diagramId);
      return { diagramId };
    },
  };
}
