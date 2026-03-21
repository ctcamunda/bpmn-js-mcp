/**
 * Custom bpmnlint rule: service-task-missing-implementation
 *
 * Warns when a bpmn:ServiceTask has no implementation configured.
 * In Camunda 8 (Zeebe), a ServiceTask needs a zeebe:TaskDefinition
 * extension element with a `type` attribute (job worker type).
 */

import { isType } from '../utils';

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:ServiceTask')) return;

    // Check for zeebe:TaskDefinition in extension elements
    const extensionElements = node.extensionElements?.values || [];
    for (const ext of extensionElements) {
      if (isType(ext, 'zeebe:TaskDefinition') && ext.type) return;
    }

    reporter.report(
      node.id,
      'Service task has no implementation — set a zeebe:TaskDefinition ' +
        'with a job worker type using set_bpmn_element_properties'
    );
  }

  return { check };
}

export default ruleFactory;
