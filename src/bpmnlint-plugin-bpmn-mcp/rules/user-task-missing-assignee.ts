/**
 * Custom bpmnlint rule: user-task-missing-assignee
 *
 * Warns when a bpmn:UserTask does not have a zeebe:AssignmentDefinition
 * extension element with at least one of: assignee, candidateGroups,
 * or candidateUsers.
 *
 * Without assignment, the Zeebe engine creates the task but nobody
 * can claim it, making the process stuck.
 */

import { isType } from '../utils';

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:UserTask')) {
      return;
    }

    // Check for zeebe:AssignmentDefinition in extension elements
    const extensionElements = node.extensionElements?.values || [];
    for (const ext of extensionElements) {
      if (isType(ext, 'zeebe:AssignmentDefinition')) {
        if (ext.assignee || ext.candidateGroups || ext.candidateUsers) return;
      }
    }

    reporter.report(
      node.id,
      'User task has no assignment — add a zeebe:AssignmentDefinition ' +
        'with assignee, candidateUsers, or candidateGroups'
    );
  }

  return { check };
}

export default ruleFactory;
