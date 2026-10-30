import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { SandboxError } from './port.js';

/**
 * Gabarit de profil : un fichier descriptif `profiles/<nom>.json`. Le bloc `srt` est un fichier de réglages srt
 * dont les chemins portent des variables ; `env` est la liste fermée de l'environnement transmis.
 *
 * Schéma strict à tous les niveaux (§5) : srt tolère une clé mal écrite [T-01], et les options d'affaiblissement
 * (`allowAllUnixSockets`, `enableWeakerNestedSandbox`, `allowNestedUserNamespaces`, `allowLocalBinding`,
 * `filesystem.disabled`, `allowGitConfig`, ...) sont refusées faute d'être dans le schéma (§4.1 E).
 * Noms des clés srt : node_modules/@anthropic-ai/sandbox-runtime/dist/sandbox/sandbox-config.js
 * (`NetworkConfigSchema`, `FilesystemConfigSchema`, `allowPty`).
 */
const PathList = z.array(z.string().min(1));

export const SrtSettingsSchema = z.strictObject({
  network: z.strictObject({
    allowedDomains: z.array(z.string().min(1)),
    deniedDomains: z.array(z.string().min(1)),
  }),
  filesystem: z.strictObject({
    denyRead: PathList,
    allowRead: PathList.optional(),
    allowWrite: PathList,
    denyWrite: PathList,
  }),
  allowPty: z.boolean().optional(),
});
export type SrtSettings = z.infer<typeof SrtSettingsSchema>;

/** Variables jamais copiées depuis l'hôte : clé ou jeton, répertoire de configuration, proxy (srt fixe le sien),
 * injection de code dans node. Les noms sensibles (`ANTHROPIC_*`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_OAUTH_TOKEN`)
 * ne peuvent être posés par `set` que depuis des variables du lanceur (jeton de session, port du proxy, dossier de
 * configuration propre à la sandbox), jamais par une valeur écrite dans le fichier. */
const FORBIDDEN_PASS =
  /^(ANTHROPIC_.*|CLAUDE_CONFIG_DIR|CLAUDE_CODE_.*|NO_PROXY|HTTPS?_PROXY|ALL_PROXY|NODE_OPTIONS)$/i;
const SENSITIVE_SET = /^(ANTHROPIC_.*|CLAUDE_CONFIG_DIR|CLAUDE_CODE_OAUTH.*)$/i;
const SENSITIVE_LITERALS = new Set(['', 'http://127.0.0.1:']);
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PassName = z
  .string()
  .regex(NAME)
  .refine((name) => !FORBIDDEN_PASS.test(name), { message: 'variable interdite' });

const Json: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(Json), z.record(z.string(), Json)]),
);

export const ProfileTemplateSchema = z.strictObject({
  description: z.string().min(1),
  srt: SrtSettingsSchema,
  env: z.strictObject({
    pass: z.array(PassName),
    set: z.record(z.string(), z.string()).superRefine((set, ctx) => {
      for (const [name, value] of Object.entries(set)) {
        if (!NAME.test(name) || /^(NO_PROXY|HTTPS?_PROXY|ALL_PROXY|NODE_OPTIONS)$/i.test(name))
          ctx.addIssue({ code: 'custom', message: `variable ${name}` });
        const literal = value.replace(/\$\{[A-Za-z]+\}/g, '');
        if (SENSITIVE_SET.test(name) && (!value.includes('${') || !SENSITIVE_LITERALS.has(literal)))
          ctx.addIssue({ code: 'custom', message: `${name} : valeur fournie par le lanceur seulement` });
      }
    }),
    /** Variables retirées dans la sandbox, après srt : `NO_PROXY` ferait contourner le proxy par le loopback
     * [T-03d, T-41]. */
    unset: z.array(z.string().regex(NAME)),
  }),
  /** Fichiers JSON écrits par le lanceur avant chaque lancement ; clés et valeurs portent des variables. */
  files: z.record(z.string(), Json),
});
export type ProfileTemplate = z.infer<typeof ProfileTemplateSchema>;

/** Variables posées par l'adaptateur ; le lanceur peut en ajouter (`SrtRunnerOptions.variables`). */
export const PROFILE_VARIABLES = ['home', 'repo', 'worktree', 'worktreeName', 'tmp', 'config'] as const;
export type ProfileVariables = Record<(typeof PROFILE_VARIABLES)[number], string> & Record<string, string>;

export interface ResolvedProfile {
  readonly settings: SrtSettings;
  readonly env: {
    readonly pass: readonly string[];
    readonly set: Readonly<Record<string, string>>;
    readonly unset: readonly string[];
  };
  /** Chemin absolu vers contenu JSON. */
  readonly files: Readonly<Record<string, unknown>>;
}

const PROFILE_NAME = /^[a-z][a-z0-9-]*$/;

export function loadTemplate(profilesDir: string, name: string): ProfileTemplate {
  if (!PROFILE_NAME.test(name)) throw new SandboxError('PROFILE_INVALID', `nom de profil refusé : ${name}`);
  const file = join(profilesDir, `${name}.json`);
  if (!existsSync(file)) throw new SandboxError('PROFILE_INVALID', `profil inconnu : ${name}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new SandboxError('PROFILE_INVALID', `${name}.json n'est pas du JSON`);
  }
  return parseTemplate(raw, name);
}

export function parseTemplate(raw: unknown, name = 'gabarit'): ProfileTemplate {
  const parsed = ProfileTemplateSchema.safeParse(raw);
  if (!parsed.success) throw new SandboxError('PROFILE_INVALID', `${name} : ${parsed.error.message}`);
  return parsed.data;
}

function substitute(value: string, vars: ProfileVariables): string {
  return value.replace(/\$\{([A-Za-z]+)\}/g, (_, key: string) => {
    const resolved = vars[key];
    if (resolved === undefined) throw new SandboxError('PROFILE_INVALID', `variable inconnue : \${${key}}`);
    return resolved;
  });
}

function substituteJson(value: unknown, vars: ProfileVariables): unknown {
  if (typeof value === 'string') return substitute(value, vars);
  if (Array.isArray(value)) return value.map((v) => substituteJson(v, vars));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [substitute(k, vars), substituteJson(v, vars)]),
    );
  return value;
}

/** Résout les variables ; chaque chemin résolu doit être absolu, chaque fichier écrit sous un `allowWrite`. */
export function resolveProfile(template: ProfileTemplate, vars: ProfileVariables): ResolvedProfile {
  const absolute = (entry: string) => {
    const resolved = substitute(entry, vars);
    if (!isAbsolute(resolved)) throw new SandboxError('PROFILE_INVALID', `chemin non absolu : ${entry}`);
    return resolved;
  };
  const paths = (list: readonly string[]) => list.map(absolute);
  const fs = template.srt.filesystem;
  const settings = SrtSettingsSchema.parse({
    ...template.srt,
    network: {
      allowedDomains: template.srt.network.allowedDomains.map((d) => substitute(d, vars)),
      deniedDomains: template.srt.network.deniedDomains.map((d) => substitute(d, vars)),
    },
    filesystem: {
      denyRead: paths(fs.denyRead),
      ...(fs.allowRead ? { allowRead: paths(fs.allowRead) } : {}),
      allowWrite: paths(fs.allowWrite),
      denyWrite: paths(fs.denyWrite),
    },
  });
  const set = Object.fromEntries(Object.entries(template.env.set).map(([k, v]) => [k, substitute(v, vars)]));
  const files = Object.fromEntries(
    Object.entries(template.files).map(([file, content]) => {
      const path = absolute(file);
      if (!settings.filesystem.allowWrite.some((root) => under(dirname(path), root)))
        throw new SandboxError('PROFILE_INVALID', `fichier hors de allowWrite : ${file}`);
      return [path, substituteJson(content, vars)];
    }),
  );
  return { settings, env: { pass: template.env.pass, set, unset: template.env.unset }, files };
}

const under = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

/** Vrai si la sandbox peut écrire `path` : sous un `allowWrite` et sous aucun `denyWrite`. Chemins réels attendus. */
export function isWritable(settings: SrtSettings, path: string): boolean {
  const { allowWrite, denyWrite } = settings.filesystem;
  return allowWrite.some((root) => under(path, root)) && !denyWrite.some((root) => under(path, root));
}

/** Environnement en liste fermée : les noms de `pass` copiés depuis l'hôte, puis `set`. */
export function closedEnv(
  profile: ResolvedProfile,
  host: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of profile.env.pass) {
    const value = host[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...profile.env.set };
}
