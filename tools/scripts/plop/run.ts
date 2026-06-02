#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nodePlop from 'node-plop';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

interface Args {
  generator: 'app' | 'lib' | 'service';
  name?: string | undefined;
  template?: string | undefined;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const [generator, ...rest] = argv;
  if (generator !== 'app' && generator !== 'lib' && generator !== 'service') {
    fail(`Unknown generator: ${generator}. Use 'app', 'lib', or 'service'.`);
  }

  let name: string | undefined;
  let template: string | undefined;
  let yes = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg) continue;
    if (arg === '--yes' || arg === '-y') {
      yes = true;
    } else if (arg === '--template') {
      template = rest[++i];
    } else if (arg.startsWith('--template=')) {
      template = arg.slice('--template='.length);
    } else if (!name) {
      name = arg;
    } else {
      fail(`Unexpected argument: ${arg}`);
    }
  }

  return { generator, name, template, yes };
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function validateName(generator: string, name: string): void {
  const prefix = `${generator}.`;
  if (!name.startsWith(prefix)) {
    fail(`Name must start with '${prefix}' (got '${name}').`);
  }
  const slug = name.slice(prefix.length);
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
    fail(`Segment after '${prefix}' must be kebab-case lowercase (got '${slug}').`);
  }
}

function targetDir(generator: 'app' | 'lib' | 'service', name: string): string {
  const folder = generator === 'lib' ? 'packages' : generator === 'app' ? 'apps' : 'services';
  return resolve(repoRoot, folder, name);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.name) {
    fail(`Provide a name. Example: pnpm new-${args.generator} ${args.generator}.example`);
  }
  validateName(args.generator, args.name);

  const dir = targetDir(args.generator, args.name);
  if (existsSync(dir)) {
    fail(`${dir} already exists. Refusing to overwrite.`);
  }

  const plop = await nodePlop(resolve(here, 'plopfile.ts'), {
    destBasePath: repoRoot,
    force: false,
  });
  const gen = plop.getGenerator(args.generator);
  const slug = args.name.slice(args.generator.length + 1);

  const answers: Record<string, unknown> = {
    name: args.name,
    slug,
  };
  if (args.generator === 'app') {
    answers.template = args.template ?? 'standard';
  }

  const result = await gen.runActions(answers, {
    onSuccess: () => undefined,
    onFailure: (err: unknown) => {
      console.error('Generator action failed:', err);
    },
    onComment: (msg: string) => {
      console.log(msg);
    },
  });

  if (result.failures.length > 0) {
    fail(`Generator produced ${result.failures.length} failure(s).`);
  }

  console.log(`\nGenerated ${args.name} at ${dir}.`);
  console.log("Run 'pnpm install' to wire the workspace.");
  if (args.generator === 'service') {
    console.log('See the printed compose fragment and paste it into infra/docker-compose.yml.');
  }
  void args.yes;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
