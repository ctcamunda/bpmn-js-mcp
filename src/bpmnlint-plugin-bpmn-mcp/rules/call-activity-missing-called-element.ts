/**
 * Custom bpmnlint rule: call-activity-missing-called-element
 *
 * Warns when a bpmn:CallActivity has no calledElement attribute and
 * no zeebe:CalledElement extension element. Without one, the Zeebe
 * engine does not know which process definition to invoke.
 */

import { isType } from '../utils';

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:CallActivity')) return;

    const calledElement = node.calledElement;

    // Check for zeebe:CalledElement extension element
    const zeebeCalledElement = (node.extensionElements?.values || []).find(
      (e: any) => e.$type === 'zeebe:CalledElement'
    );

    if (!calledElement && !zeebeCalledElement) {
      reporter.report(
        node.id,
        'Call activity has no calledElement — the engine will not know ' +
          'which process to invoke. ' +
          'Use set_bpmn_element_properties to set calledElement'
      );
    }
  }

  return { check };
}

export default ruleFactory;
