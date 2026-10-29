export interface ToolDescriptor {
  name: string;
  description: string;
  /** Service that owns the tool and executes it. */
  owner: string;
}

/** The set of tools the gateway exposes. Pure data; no behaviour beyond lookup. */
export class ToolCatalogue {
  private readonly byName: Map<string, ToolDescriptor>;

  constructor(descriptors: readonly ToolDescriptor[]) {
    this.byName = new Map(descriptors.map((d) => [d.name, d]));
  }

  find(name: string): ToolDescriptor | undefined {
    return this.byName.get(name);
  }

  list(): ToolDescriptor[] {
    return [...this.byName.values()];
  }
}
