import { Clone, Reference, Repository } from 'nodegit';
import { StarbaseConfig, StarbaseIntegration } from './types';
import { isDirectoryPresent } from '@jupiterone/integration-sdk-runtime';
import { executeWithLogging } from './process';
import camelCase from 'lodash.camelcase';
import mapkeys from 'lodash.mapkeys';
import Ajv, { Schema } from 'ajv';

const ajv = new Ajv();
ajv.addKeyword('mask');

async function setupStarbase(config: StarbaseConfig) {
  for (const integration of config.integrations) {
    await setupIntegration(integration);
    await checkInstanceConfigFields(integration);
    await installIntegrationDependencies(integration.directory);
  }
}

async function installIntegrationDependencies(directory: string) {
  return executeWithLogging(`yarn --cwd ${directory} install`);
}

/**
 * After we have cloned the repository, pull down information on the required
 * instanceConfigFields and perform additional checks.
 */
async function checkInstanceConfigFields(integration: StarbaseIntegration) {
  await import(`../.${integration.directory}/src/index`).then(
    ({ invocationConfig }) => {
      if (invocationConfig.instanceConfigFields) {
        const integrationSchema: Schema = {
          type: 'object',
          properties: invocationConfig.instanceConfigFields,
          required: Object.keys(invocationConfig.instanceConfigFields),
        };
        const validator = ajv.compile(integrationSchema);
        // We have to camelCase our integration config to mimic what will happen when our
        // integrations run for real.
        const camelCaseConfig = mapkeys(integration.config, (_value, key) => {
          return camelCase(key);
        });
        if (!validator(camelCaseConfig)) {
          // Log but don't throw an error so we can report errors for all integration configurations, not just the first failure
          console.error(
            `ERROR:  instanceConfigFields validation error(s) for ${integration.name}:  `,
            validator.errors,
          );
        }
      }
    },
  );
}

/**
 * Clones or updates an integration based on whether the integration
 * directory already exists or not
 */
async function setupIntegration(integration: StarbaseIntegration) {
  if (!integration.gitRemoteUrl) return;

  if (await isDirectoryPresent(integration.directory)) {
    await updateIntegrationDirectory(integration.directory);
  } else {
    await Clone.clone(integration.gitRemoteUrl, integration.directory);
  }
}

/**
 * Updates an integration directory by fetching the latest from the
 * `main` branch
 */
async function updateIntegrationDirectory(directory: string) {
  let repo = await Repository.open(directory);
  await repo.fetchAll();

  const localMain: Reference = await repo.getCurrentBranch();
  const originMain = await repo.getBranch('origin/main');
  await repo.mergeBranches(localMain, originMain);
}

export { setupStarbase };
