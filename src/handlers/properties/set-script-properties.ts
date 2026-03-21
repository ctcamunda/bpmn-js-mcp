/**
 * Script property handling for set_bpmn_element_properties.
 *
 * Extracted to keep set-properties.ts within lint line limits.
 * In Camunda 8 (Zeebe), script tasks use FEEL expressions via
 * zeebe:Script extension element. The scriptFormat and inline script
 * approach is not used — instead, zeebe:script is handled by
 * set-properties.ts directly. This handler provides backwards
 * compatibility for scriptFormat/script standard BPMN properties.
 */

import { getService } from '../helpers';

/**
 * Handle `scriptFormat` + `script` — sets inline script content
 * on ScriptTask elements. Mutates `standardProps` and `zeebeProps` in-place.
 * Returns true if script properties were handled.
 *
 * Note: In Camunda 8, prefer using zeebe:script instead of the standard
 * BPMN scriptFormat/script properties.
 */
export function handleScriptProperties(
  element: any,
  standardProps: Record<string, any>,
  zeebeProps: Record<string, any>,
  diagram: any
): boolean {
  const hasScriptFormat = 'scriptFormat' in standardProps;
  const hasScript = 'script' in standardProps;

  if (!hasScriptFormat && !hasScript) return false;

  const bo = element.businessObject;
  if (!bo.$type.includes('ScriptTask')) return false;

  const modeling = getService(diagram.modeler, 'modeling');

  if (hasScriptFormat) {
    modeling.updateProperties(element, { scriptFormat: standardProps['scriptFormat'] });
    delete standardProps['scriptFormat'];
  }

  if (hasScript) {
    bo.script = standardProps['script'];
    delete standardProps['script'];
  }

  // Consume any zeebe: props that were already handled by set-properties.ts
  void zeebeProps;

  return true;
}
