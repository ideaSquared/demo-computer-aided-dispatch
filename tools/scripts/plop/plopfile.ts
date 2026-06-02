import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NodePlopAPI } from 'plop';

const here = dirname(fileURLToPath(import.meta.url));

export default function plopfile(plop: NodePlopAPI): void {
  plop.setHelper('uppercase', (s: string) => String(s).toUpperCase());

  plop.setGenerator('app', {
    description: 'Scaffold a new React + Vite + vanilla-extract app under apps/',
    prompts: [],
    actions: (data) => {
      const { name, template } = data ?? {};
      const templateDir = resolve(here, 'templates', 'app');
      const targetDir = `apps/${name}`;
      return [
        {
          type: 'addMany',
          destination: targetDir,
          base: templateDir,
          templateFiles: `${templateDir}/**/*`,
          globOptions: { dot: true },
          stripExtensions: ['hbs'],
          data: { name, template, slug: data?.slug },
        },
      ];
    },
  });

  plop.setGenerator('lib', {
    description: 'Scaffold a new shared TypeScript library under packages/',
    prompts: [],
    actions: (data) => {
      const { name } = data ?? {};
      const templateDir = resolve(here, 'templates', 'lib');
      const targetDir = `packages/${name}`;
      return [
        {
          type: 'addMany',
          destination: targetDir,
          base: templateDir,
          templateFiles: `${templateDir}/**/*`,
          globOptions: { dot: true },
          stripExtensions: ['hbs'],
          data: { name, slug: data?.slug },
        },
      ];
    },
  });

  plop.setGenerator('service', {
    description: 'Scaffold a new Node + Fastify + gRPC service under services/',
    prompts: [],
    actions: (data) => {
      const { name, slug } = data ?? {};
      const templateDir = resolve(here, 'templates', 'service');
      const targetDir = `services/${name}`;
      return [
        {
          type: 'addMany',
          destination: targetDir,
          base: templateDir,
          templateFiles: `${templateDir}/**/*`,
          globOptions: { dot: true },
          stripExtensions: ['hbs'],
          data: { name, slug },
        },
      ];
    },
  });
}
