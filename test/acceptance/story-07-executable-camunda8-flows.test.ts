import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  handleAddElement,
  handleAddElementChain,
  handleConfigureZeebeExtensions,
  handleConnect,
  handleCreateDiagram,
  handleCreateParticipant,
  handleExportBpmn,
  handleGenerateFromStructure,
  handleLayoutDiagram,
  handleSetFormData,
  handleSetProperties,
  handleValidate,
} from '../../src/handlers';
import { disablePersistence, enablePersistence, persistAllDiagrams } from '../../src/persistence';
import { clearDiagrams, parseResult } from '../helpers';

async function expectLintClean(diagramId: string): Promise<void> {
  const lintRes = parseResult(await handleValidate({ diagramId }));
  const errors = (lintRes.issues || []).filter((issue: any) => issue.severity === 'error');
  expect(errors).toEqual([]);
}

async function exportXml(diagramId: string): Promise<string> {
  return (await handleExportBpmn({ diagramId, format: 'xml' })).content[0].text;
}

describe('Story 7: Executable Camunda 8 acceptance flows', () => {
  let tmpDir: string;

  beforeEach(() => {
    clearDiagrams();
    disablePersistence();
    tmpDir = path.join(process.cwd(), 'test-tmp', 'acceptance-persistence');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    disablePersistence();
    clearDiagrams();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('flat executable flow passes the Camunda 8 lint gate using the Zeebe batch shortcut plus specialized tools', async () => {
    const createRes = parseResult(await handleCreateDiagram({ name: 'Flat Executable Flow' }));
    const diagramId = createRes.diagramId as string;

    const chainRes = parseResult(
      await handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Request Received' },
          { elementType: 'bpmn:UserTask', name: 'Review Request' },
          { elementType: 'bpmn:ServiceTask', name: 'Process Request' },
          { elementType: 'bpmn:EndEvent', name: 'Completed' },
        ],
      })
    );

    const [startId, reviewId, serviceId] = chainRes.elementIds as string[];

    const zeebeRes = parseResult(
      await handleConfigureZeebeExtensions({
        diagramId,
        elements: {
          [reviewId]: {
            assignment: { candidateGroups: 'operations' },
          },
          [serviceId]: {
            taskDefinition: { type: 'process-request', retries: 3 },
            ioMapping: {
              inputs: [{ source: '=requestId', target: 'requestId' }],
              outputs: [{ source: '=approved', target: 'approved' }],
            },
          },
        },
      })
    );
    expect(zeebeRes.success).toBe(true);

    const formRes = parseResult(
      await handleSetFormData({
        diagramId,
        elementId: startId,
        formId: 'request-form',
      })
    );
    expect(formRes.success).toBe(true);

    const layoutRes = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutRes.success).toBe(true);

    await expectLintClean(diagramId);

    const xml = await exportXml(diagramId);
    expect(xml).toContain('zeebe:assignmentDefinition');
    expect(xml).toContain('zeebe:taskDefinition');
    expect(xml).toContain('zeebe:ioMapping');
    expect(xml).toContain('zeebe:formDefinition');
  });

  test('executable pool with lanes passes create, configure, layout, validate, and export', async () => {
    const createRes = parseResult(await handleCreateDiagram({ name: 'Lane Executable Flow' }));
    const diagramId = createRes.diagramId as string;

    const participantRes = parseResult(
      await handleCreateParticipant({
        diagramId,
        name: 'Order Handling',
        lanes: [{ name: 'Requester' }, { name: 'Operations' }],
      })
    );
    expect(participantRes.success).toBe(true);

    const participantId = participantRes.participantId as string;
    const [requesterLaneId, operationsLaneId] = participantRes.laneIds as string[];

    const startRes = parseResult(
      await handleAddElement({
        diagramId,
        participantId,
        laneId: requesterLaneId,
        elementType: 'bpmn:StartEvent',
        name: 'Ticket Submitted',
      })
    );
    const startId = startRes.elementId as string;

    const reviewRes = parseResult(
      await handleAddElement({
        diagramId,
        participantId,
        laneId: requesterLaneId,
        afterElementId: startId,
        elementType: 'bpmn:UserTask',
        name: 'Review Ticket',
      })
    );
    const reviewId = reviewRes.elementId as string;

    const serviceRes = parseResult(
      await handleAddElement({
        diagramId,
        participantId,
        laneId: operationsLaneId,
        afterElementId: reviewId,
        elementType: 'bpmn:ServiceTask',
        name: 'Update Backend',
      })
    );
    const serviceId = serviceRes.elementId as string;

    const endRes = parseResult(
      await handleAddElement({
        diagramId,
        participantId,
        laneId: operationsLaneId,
        afterElementId: serviceId,
        elementType: 'bpmn:EndEvent',
        name: 'Ticket Completed',
      })
    );
    expect(endRes.success).toBe(true);

    await handleSetProperties({
      diagramId,
      elementId: reviewId,
      properties: { 'zeebe:assignmentDefinition': { assignee: 'support-agent' } },
    });
    await handleSetProperties({
      diagramId,
      elementId: serviceId,
      properties: { 'zeebe:taskDefinition': { type: 'update-backend' } },
    });

    const layoutRes = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutRes.success).toBe(true);

    await expectLintClean(diagramId);

    const xml = await exportXml(diagramId);
    expect(xml).toContain('bpmn:laneSet');
    expect(xml).toContain('Ticket Submitted');
    expect(xml).toContain('zeebe:assignmentDefinition');
    expect(xml).toContain('zeebe:taskDefinition');
  });

  test('collaboration with one executable pool and a collapsed partner pool passes validation and export', async () => {
    const createRes = parseResult(await handleCreateDiagram({ name: 'Executable Collaboration' }));
    const diagramId = createRes.diagramId as string;

    const collaborationRes = parseResult(
      await handleCreateParticipant({
        diagramId,
        participants: [
          {
            name: 'Order Process',
            participantId: 'Participant_OrderProcess',
            processId: 'Process_OrderProcess',
          },
          {
            name: 'ERP System',
            participantId: 'Participant_ERPSystem',
            collapsed: true,
          },
        ],
      })
    );
    expect(collaborationRes.success).toBe(true);

    const [mainParticipantId, partnerParticipantId] = collaborationRes.participantIds as string[];

    const chainRes = parseResult(
      await handleAddElementChain({
        diagramId,
        participantId: mainParticipantId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Order Created' },
          { elementType: 'bpmn:ServiceTask', name: 'Send Order To ERP' },
          { elementType: 'bpmn:EndEvent', name: 'Order Sent' },
        ],
      })
    );

    const [, serviceId] = chainRes.elementIds as string[];

    await handleSetProperties({
      diagramId,
      elementId: serviceId,
      properties: { 'zeebe:taskDefinition': { type: 'send-order-to-erp' } },
    });

    const messageFlowRes = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: serviceId,
        targetElementId: partnerParticipantId,
        label: 'Order payload',
      })
    );
    expect(messageFlowRes.connectionType).toBe('bpmn:MessageFlow');

    const layoutRes = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutRes.success).toBe(true);

    await expectLintClean(diagramId);

    const xml = await exportXml(diagramId);
    expect(xml).toContain('bpmn:participant');
    expect(xml).toContain('bpmn:messageFlow');
    expect(xml).toContain('isExpanded="false"');
  });

  test('generate_bpmn_from_structure can be the primary authoring path for an executable Camunda 8 process', async () => {
    const generateRes = parseResult(
      await handleGenerateFromStructure({
        name: 'Generated Executable Flow',
        elements: [
          { id: 'start', type: 'startEvent', name: 'Application Received' },
          { id: 'review', type: 'userTask', name: 'Review Application', after: 'start' },
          { id: 'score', type: 'serviceTask', name: 'Score Application', after: 'review' },
          { id: 'end', type: 'endEvent', name: 'Application Scored', after: 'score' },
        ],
      })
    );
    expect(generateRes.success).toBe(true);

    const diagramId = generateRes.diagramId as string;
    const reviewId = generateRes.elementIdMap.review as string;
    const scoreId = generateRes.elementIdMap.score as string;
    const startId = generateRes.elementIdMap.start as string;

    await handleSetProperties({
      diagramId,
      elementId: reviewId,
      properties: { 'zeebe:assignmentDefinition': { candidateGroups: 'underwriters' } },
    });
    await handleSetProperties({
      diagramId,
      elementId: scoreId,
      properties: { 'zeebe:taskDefinition': { type: 'score-application', retries: 5 } },
    });
    await handleSetFormData({
      diagramId,
      elementId: startId,
      formId: 'application-form',
    });

    await expectLintClean(diagramId);

    const xml = await exportXml(diagramId);
    expect(xml).toContain('Review Application');
    expect(xml).toContain('Score Application');
    expect(xml).toContain('zeebe:taskDefinition');
    expect(xml).toContain('zeebe:assignmentDefinition');
  });

  test('persistence roundtrip preserves Zeebe extensions on an executable diagram', async () => {
    const createRes = parseResult(await handleCreateDiagram({ name: 'Persistent Executable Flow' }));
    const diagramId = createRes.diagramId as string;

    const chainRes = parseResult(
      await handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start Intake' },
          { elementType: 'bpmn:UserTask', name: 'Review Intake' },
          { elementType: 'bpmn:ServiceTask', name: 'Persist Decision' },
          { elementType: 'bpmn:EndEvent', name: 'Finished Intake' },
        ],
      })
    );

    const [startId, reviewId, serviceId] = chainRes.elementIds as string[];

    await handleSetProperties({
      diagramId,
      elementId: reviewId,
      properties: { 'zeebe:assignmentDefinition': { assignee: 'case-worker' } },
    });
    await handleSetProperties({
      diagramId,
      elementId: serviceId,
      properties: { 'zeebe:taskDefinition': { type: 'persist-decision' } },
    });
    await handleSetFormData({
      diagramId,
      elementId: startId,
      formId: 'intake-form',
    });

    await expectLintClean(diagramId);

  await enablePersistence(tmpDir);
  const persistedCount = await persistAllDiagrams();
  expect(persistedCount).toBeGreaterThanOrEqual(1);

    const persistedXmlPath = path.join(tmpDir, `${diagramId}.bpmn`);
    expect(fs.existsSync(persistedXmlPath)).toBe(true);
    const persistedXml = fs.readFileSync(persistedXmlPath, 'utf-8');
    expect(persistedXml).toContain('zeebe:assignmentDefinition');
    expect(persistedXml).toContain('zeebe:taskDefinition');
    expect(persistedXml).toContain('zeebe:formDefinition');

    clearDiagrams();
    disablePersistence();

    const loadedCount = await enablePersistence(tmpDir);
    expect(loadedCount).toBeGreaterThanOrEqual(1);

    await expectLintClean(diagramId);

    const reloadedXml = await exportXml(diagramId);
    expect(reloadedXml).toContain('zeebe:assignmentDefinition');
    expect(reloadedXml).toContain('zeebe:taskDefinition');
    expect(reloadedXml).toContain('zeebe:formDefinition');
  });
});