import type { ToolCatalogue, ToolDescriptor } from '../domain/catalogue.js';

export class ListTools {
  constructor(private readonly catalogue: ToolCatalogue) {}

  execute(): ToolDescriptor[] {
    return this.catalogue.list();
  }
}
