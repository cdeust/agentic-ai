import { PassThrough } from 'node:stream';
import {
  SandboxError,
  type Sandbox,
  type SandboxExit,
  type SandboxRequest,
  type SandboxRunner,
} from './port.js';

/**
 * Adaptateur en mémoire du port, pour les tests des appelants : un écho de stdin vers stdout, quel que soit
 * l'argv. Aucun processus, aucune isolation : il ne remplace jamais l'adaptateur srt hors des tests.
 */
export class InMemorySandboxRunner implements SandboxRunner {
  constructor(private readonly profiles: readonly string[]) {}

  async start(request: SandboxRequest): Promise<Sandbox> {
    if (!this.profiles.includes(request.profile))
      throw new SandboxError('PROFILE_INVALID', `profil inconnu : ${request.profile}`);
    if (request.command.length === 0) throw new SandboxError('COMMAND_NOT_FOUND', 'argv vide');
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let finish: (exit: SandboxExit) => void = () => {};
    const exited = new Promise<SandboxExit>((done) => {
      let settled = false;
      finish = (exit) => {
        if (settled) return;
        settled = true;
        stdout.end();
        stderr.end();
        done(exit);
      };
    });
    stdin.pipe(stdout, { end: false });
    stdin.on('end', () => finish({ code: 0, signal: null }));
    return {
      stdin,
      stdout,
      stderr,
      exited,
      stop: async () => {
        finish({ code: null, signal: 'SIGTERM' });
        return exited;
      },
    };
  }
}
