/**
 * Opaque typed reference to one field declared during plugin registration.
 *
 * The host creates handles. Plugin code can retain and pass them back to
 * `PackedNode.get`, but cannot construct, inspect, or rebind one.
 */
declare const FIELD_VALUE: unique symbol;
declare const FIELD_KIND: unique symbol;
export interface FieldHandle<Value, Kind = unknown> {
  readonly [FIELD_VALUE]: (value: Value) => Value;
  readonly [FIELD_KIND]: (kind: Kind) => Kind;
}

export interface FieldOptions<Value> {
  readonly default?: Value;
}

export type PluginScalar = string | number | boolean;
export type PluginJson =
  | null
  | PluginScalar
  | readonly PluginJson[]
  | { readonly [key: string]: PluginJson };

export interface KindFieldBuilder<Kind = unknown> {
  f64(name: string, options?: FieldOptions<number>): FieldHandle<number, Kind>;
  i32(name: string, options?: FieldOptions<number>): FieldHandle<number, Kind>;
  bool(name: string, options?: FieldOptions<boolean>): FieldHandle<boolean, Kind>;
  string(name: string, options?: FieldOptions<string>): FieldHandle<string, Kind>;
  text(name: string): FieldHandle<string, Kind>;
}

export const Primitive = {
  RoundRect: 0,
  Ellipse: 1,
  None: 2,
  TextBlock: 100,
  ImageQuad: 101,
} as const;
export type Primitive = (typeof Primitive)[keyof typeof Primitive];

export const TextFont = {
  Sans: 0,
  Serif: 1,
  Mono: 2,
} as const;
export type TextFont = number;

export const TextAlign = {
  Left: 0,
  Center: 1,
  Right: 2,
} as const;
export type TextAlign = (typeof TextAlign)[keyof typeof TextAlign];

export const TextVerticalAlign = {
  Top: 0,
  Middle: 1,
  Bottom: 2,
} as const;
export type TextVerticalAlign =
  (typeof TextVerticalAlign)[keyof typeof TextVerticalAlign];

export const TextSizing = {
  Fixed: 0,
  AutoWidth: 1,
  AutoHeight: 2,
  Auto: 3,
} as const;

/** Sentinel used by text layout when wrapping is disabled. */
export const UNBOUNDED_WRAP = Number.MAX_SAFE_INTEGER;

export interface TextStyle {
  readonly family: 'sans' | 'serif' | 'mono';
  readonly weight: number;
  readonly italic: boolean;
  readonly size: number;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly align: 'left' | 'center' | 'right';
  readonly color: number;
}

export interface PrimitiveWriter {
  quad(
    x: number,
    y: number,
    halfW: number,
    halfH: number,
    rotation: number,
    cornerRadius: number,
    strokeWidth: number,
    primitive: Primitive,
    fill: number,
    stroke: number,
  ): void;
  textBlock(block: {
    x: number;
    y: number;
    halfW: number;
    halfH: number;
    text: string;
    style: TextStyle;
    font: number;
    wrapWidth: number;
    padding: number;
    /** Overrides vertical inset while preserving `padding` horizontally. */
    verticalPadding?: number;
    verticalAlign: number;
    readonly background?: {
      readonly fill: number;
      readonly cornerRadius: number;
    };
  }): void;
  imageQuad(
    assetId: string,
    x: number,
    y: number,
    halfW: number,
    halfH: number,
    rotation: number,
  ): void;
  imageQuad(
    source: { readonly url: string },
    x: number,
    y: number,
    halfW: number,
    halfH: number,
    rotation: number,
  ): void;
  interactionRegion(
    interactionId: string,
    x: number,
    y: number,
    width: number,
    height: number,
    semantics: {
      readonly role: 'button' | 'link';
      readonly label: string;
    },
  ): void;
}

export interface PackServices {
  readonly text: {
    readonly sharedTextStyle: TextStyle;
    familyOf(font: number): TextStyle['family'];
  };
}

export type PackFunction<Kind = unknown> = (
  node: PackedNode<Kind>,
  services: PackServices,
  out: PrimitiveWriter,
) => void;

export interface CreateContribution {
  readonly label: string;
  readonly icon?: string;
  readonly shortcut: string;
  readonly cursor: 'crosshair' | 'text';
  readonly gesture: 'drag' | 'place';
  readonly order: number;
  readonly defaultSize: { readonly width: number; readonly height: number };
  readonly styleSlot: 'shape' | 'palette' | 'text';
  readonly opensTextEditor?: boolean;
}

export interface TextContribution<Kind = unknown> {
  readonly field: FieldHandle<string, Kind>;
  readonly padding: number | 'node';
  readonly verticalAlign: 'top' | 'center' | 'node';
  readonly font: 'shared' | 'node';
  readonly width: 'user' | 'auto' | 'derived';
  readonly height: 'user' | 'auto' | 'derived';
  readonly minWidth?: number;
  readonly minHeight?: number;
}

export interface StyleDefaults {
  readonly fill?: number;
  readonly stroke?: number;
  readonly strokeWidth?: number;
  readonly cornerRadius?: number;
  readonly fontSize?: number;
  readonly textColor?: number;
  readonly lineHeight?: number;
  readonly textSizing?: number;
}

export interface PluginSelectionSummary {
  readonly count: number;
  readonly kindIds: readonly string[];
}

export interface PluginSelection {
  snapshot(): PluginSelectionSummary;
  nodeIds(): readonly string[];
}

export interface PluginNodeSnapshot {
  readonly id: string;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly fill: number;
  readonly stroke: number;
  readonly strokeWidth: number;
  readonly fontFamily: TextFont;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly fontItalic: boolean;
  readonly textAlign: TextAlign;
  readonly textColor: number;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly textPadding: number;
  readonly textVerticalAlign: TextVerticalAlign;
  field<Value extends PluginScalar>(name: string): Value | undefined;
}

export interface PluginNodeCreate {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: number;
  readonly fill?: number;
  readonly stroke?: number;
  readonly strokeWidth?: number;
  readonly fontFamily?: TextFont;
  readonly fontSize?: number;
  readonly fontWeight?: number;
  readonly fontItalic?: boolean;
  readonly textAlign?: TextAlign;
  readonly textColor?: number;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly textPadding?: number;
  readonly textVerticalAlign?: TextVerticalAlign;
  readonly fields?: Readonly<Record<string, PluginScalar>>;
}

export interface PluginNodeUpdate {
  readonly id: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: number;
  readonly fill?: number;
  readonly stroke?: number;
  readonly strokeWidth?: number;
  readonly fontFamily?: TextFont;
  readonly fontSize?: number;
  readonly fontWeight?: number;
  readonly fontItalic?: boolean;
  readonly textAlign?: TextAlign;
  readonly textColor?: number;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly textPadding?: number;
  readonly textVerticalAlign?: TextVerticalAlign;
  readonly fields?: Readonly<Record<string, PluginScalar>>;
}

export interface PluginDocumentTransaction {
  create(node: PluginNodeCreate): void;
  update(node: PluginNodeUpdate): void;
  delete(nodeId: string): void;
  commit(): void;
}

export interface PluginDocument {
  readonly revision: number;
  inspect(nodeIds: readonly string[]): readonly PluginNodeSnapshot[];
  transaction(label: string): PluginDocumentTransaction;
}

export interface PluginSettings {
  get(key: string): PluginScalar | undefined;
}

export interface PluginSecrets {
  get(name: string): Promise<string | undefined>;
}

export interface PluginNetworkRequest {
  readonly url: string;
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  readonly response?: 'json' | 'text' | 'bytes';
  readonly timeoutMs?: number;
  /** Host-injected board credential, available only for the first-party service. */
  readonly auth?: 'board';
}

export interface PluginNetworkResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: PluginJson | string | Uint8Array;
}

export interface PluginNetwork {
  request(request: PluginNetworkRequest): Promise<PluginNetworkResponse>;
}

export interface PluginRemoteImageDimensions {
  readonly width: number;
  readonly height: number;
}

export interface PluginRemoteMedia {
  /**
   * Decodes an exact URL under this plugin's declared remote-media policy and
   * leaves the result warm in the host image cache.
   */
  probe(url: string): Promise<PluginRemoteImageDimensions>;
}

export interface PluginPickerLink {
  readonly label: string;
  readonly href: string;
}

export interface PluginPickerItem<Value extends PluginJson = PluginJson> {
  readonly value: Value;
  readonly label: string;
  readonly description?: string;
  readonly imageUrl?: string;
  readonly links?: readonly PluginPickerLink[];
}

export type PluginNotificationTone =
  | 'info'
  | 'success'
  | 'warning'
  | 'error';

export interface PluginNotification {
  /** Short notification heading rendered as text by the host. */
  readonly title: string;
  /** Optional supporting copy rendered as text by the host. */
  readonly message?: string;
  /**
   * The host owns placement and lifetime. Info, success, and warning notices
   * leave automatically; errors remain until resolved or dismissed.
   */
  readonly tone?: PluginNotificationTone;
}

export interface PluginActionUi {
  prompt(options: {
    readonly label: string;
    readonly description?: string;
    readonly initial?: string | number;
  }): Promise<string | number | null>;
  confirm(options: {
    readonly label: string;
    readonly description?: string;
  }): Promise<boolean>;
  pick<Value extends PluginJson>(options: {
    readonly label: string;
    readonly description?: string;
    readonly items: readonly PluginPickerItem<Value>[];
  }): Promise<Value | null>;
  /**
   * Publishes a bounded notice into the host notification tray. Plugins cannot
   * choose its position, duration, markup, or actions.
   */
  notify(notification: PluginNotification): void;
  progress(message: string): void;
  error(message: string): void;
}

/**
 * Controls trusted plugin editor surfaces owned by the current plugin.
 *
 * Manual editor state is transient host UI state: it is bounded JSON, is not
 * written to the canvas document, and disappears with the current runtime.
 */
export interface PluginEditors {
  open(editorId: string, state?: PluginJson): void;
  close(editorId: string): void;
  state(editorId: string): PluginJson | undefined;
}

export interface PluginActionContext {
  readonly signal: AbortSignal;
  /** Stable board id for constructing declared board-scoped service requests. */
  readonly boardId?: string;
  readonly document: PluginDocument;
  readonly selection: PluginSelection;
  readonly settings: PluginSettings;
  readonly secrets: PluginSecrets;
  readonly network: PluginNetwork;
  readonly remoteMedia: PluginRemoteMedia;
  readonly ui: PluginActionUi;
  readonly editors: PluginEditors;
  openExternal(url: string): Promise<void>;
}

export interface PluginCommandContribution {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly shortcut?: string;
  /** Exposes this command as a toolbar button in addition to the command palette. */
  readonly toolbar?: {
    /** Optional toolbar-only label; the command palette keeps the command label. */
    readonly label?: string;
    /** Built-in glyph key or explicit `./path.svg` bundled in the plugin artifact. */
    readonly icon?: string;
    readonly order: number;
    /**
     * Manual editor whose open state makes this button behave as an active
     * canvas tool. The host dismisses that editor after choosing empty canvas
     * or a different object, while clicks on the current selection keep it open.
     */
    readonly activeEditor?: string;
  };
  readonly selection?: {
    readonly minimum?: number;
    readonly maximum?: number;
    readonly kinds?: readonly string[];
  };
  run(context: PluginActionContext): Promise<void>;
}

export interface PluginImporterInput {
  readonly operation: 'paste' | 'drop';
  readonly text?: string;
  readonly uriList?: readonly string[];
  readonly files: readonly {
    readonly name: string;
    readonly mediaType: string;
    readonly byteLength: number;
    readBytes(): Promise<Uint8Array>;
  }[];
  readonly point: { readonly x: number; readonly y: number };
}

export interface PluginImporterContribution {
  readonly id: string;
  readonly label: string;
  readonly priority?: number;
  readonly match: {
    readonly mediaTypes?: readonly string[];
    readonly extensions?: readonly string[];
    readonly urlSchemes?: readonly string[];
    readonly urlHosts?: readonly string[];
  };
  import(
    input: PluginImporterInput,
    context: PluginActionContext,
  ): Promise<'handled' | 'rejected'>;
}

export interface PluginAgentActionContribution<
  Input extends PluginJson = PluginJson,
  Output extends PluginJson = PluginJson,
> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, PluginJson>>;
  readonly outputSchema: Readonly<Record<string, PluginJson>>;
  readonly requiresConfirmation: boolean;
  run(input: Input, context: PluginActionContext): Promise<Output>;
}

export interface PluginInteractionContribution {
  readonly id: string;
  readonly label: string;
  readonly cursor: 'pointer' | 'default';
  activate(
    node: PluginNodeSnapshot,
    context: PluginActionContext,
  ): Promise<void>;
}

export type PluginEditorSurface =
  | 'toolbar'
  | 'left-sidebar'
  | 'right-sidebar';

export interface PluginEditorInstance {
  update?(context: PluginActionContext): void;
  dispose(): void;
}

export interface PluginEditorContribution {
  readonly id: string;
  readonly label: string;
  readonly surface: PluginEditorSurface;
  readonly order?: number;
  /**
   * Automatic editors follow their selection requirement. Manual editors are
   * hidden until this plugin opens them through `context.editors`.
   */
  readonly activation?: 'automatic' | 'manual';
  /**
   * Omit to allow any selection. When present, every selected node must match
   * the declared kinds. This applies after the activation requirement.
   */
  readonly selection?: {
    readonly minimum?: number;
    readonly maximum?: number;
    readonly kinds?: readonly string[];
  };
  /**
   * Mounts trusted plugin UI directly into Editful's renderer. Plugins may use
   * plain DOM or mount a bundled React root and must release owned resources.
   */
  mount(
    container: HTMLElement,
    context: PluginActionContext,
  ): void | (() => void) | PluginEditorInstance;
}

export interface KindBuilder<Kind = unknown> {
  readonly field: KindFieldBuilder<Kind>;
  create(contribution: CreateContribution): void;
  hit(shape: 'rect' | 'ellipse'): void;
  text(contribution: TextContribution<Kind>): void;
  defaults(contribution: StyleDefaults): void;
  agent(contribution: { readonly name: string; readonly description?: string }): void;
  interaction(contribution: PluginInteractionContribution): void;
  asset(): void;
  pack(fn: PackFunction<Kind>): void;
}

/** Read-only node view valid only for the duration of one pack call. */
export interface PackedNode<Kind = unknown> {
  readonly x: number;
  readonly y: number;
  readonly halfW: number;
  readonly halfH: number;
  readonly rotation: number;
  readonly cornerRadius: number;
  readonly strokeWidth: number;
  readonly fill: number;
  readonly stroke: number;
  readonly assetId: string;
  readonly fontFamily: number;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly fontItalic: boolean;
  readonly textAlign: number;
  readonly textColor: number;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly textPadding: number;
  readonly textVerticalAlign: number;
  readonly textSizing: number;
  get<Value>(field: FieldHandle<Value, Kind>): Value;
}

export interface PluginContext {
  readonly pluginId: string;
  kind<const Id extends string>(id: Id): KindBuilder<Id>;
  command(contribution: PluginCommandContribution): void;
  editor(contribution: PluginEditorContribution): void;
  importer(contribution: PluginImporterContribution): void;
  action(contribution: PluginAgentActionContribution): void;
}

export interface PluginDefinition {
  register(context: PluginContext): void;
}

/** Identity helper preserving the definition's precise inferred type. */
export function definePlugin<const Definition extends PluginDefinition>(
  plugin: Definition,
): Definition {
  return plugin;
}

export class PluginActionCancelledError extends Error {
  constructor(message = 'Plugin action was cancelled') {
    super(message);
    this.name = 'PluginActionCancelledError';
  }
}

export class PluginActionConflictError extends Error {
  constructor(message = 'The document changed before the plugin action committed') {
    super(message);
    this.name = 'PluginActionConflictError';
  }
}

export class PluginConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginConfigurationError';
  }
}

export class PluginNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginNetworkError';
  }
}

export class PluginHostFeatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginHostFeatureError';
  }
}
export { validatePluginActionSchema } from './action-schema.js';
