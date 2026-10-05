import { bookingTemplate } from './booking';
import { inventoryTemplate } from './inventory';
import { paymentTemplate } from './payment';
import type { TemplateDef } from './types';
import { webhookTemplate } from './webhook';

export * from './types';

/** Allowlist of built-in workflows. Requests can only select templates from this list by id. */
export const TEMPLATES: readonly TemplateDef[] = [
  bookingTemplate,
  paymentTemplate,
  inventoryTemplate,
  webhookTemplate,
];

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((template) => template.id === id);
}
