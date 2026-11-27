// The Xcode extension's tools for agents (Stellar offers them as xcode_projects and xcode_run): which Xcode projects
// and schemes the chat's project has, and an action (build, run, test, clean) as a terminal task, the same tab the
// sidebar starts. What isn't given comes from the sidebar's choices for that project, like its buttons.
import { storage, tools, z } from 'stellar/extension';
import * as xcode from './lib/xcode.mjs';
import { AGENT_ACTIONS, rootOf, runAction } from './lib/actions.mjs';

tools.register('projects', {
  title: 'Xcode-projecten',
  description: 'De Xcode-projecten en -workspaces in het project van deze chat, met hun schemes en configuraties, en wat '
    + 'er in de Xcode-zijbalk gekozen is (project, scheme, configuratie, bestemming).',
  readOnly: true,
  run: async (_args, context) => {
    const root = rootOf(context);
    const { projects } = xcode.projectInfo(root);
    if (!projects.length) return 'Geen Xcode-project gevonden in dit project.';
    const listed = await Promise.all(projects.map(async (p) => ({
      ...p, ...(await xcode.listSchemes(root, p.path).catch((error) => ({ error: error.message }))),
    })));
    return { projects: listed, chosen: (await storage.project.get('choices')) || {} };
  },
});

tools.register('run', {
  title: 'Xcode-actie',
  description: 'Bouwt, start, test of schoont een Xcode-scheme op in een terminaltab van Stellar (dezelfde als de knoppen '
    + 'in de Xcode-zijbalk). Wat je weglaat komt uit de keuzes van de zijbalk. Met wait: true wacht hij en geeft de '
    + 'laatste regels en de uitslag; anders het terminal-id (lees de uitvoer met terminal_wait of terminal_read).',
  input: {
    action: z.enum(AGENT_ACTIONS).describe('build, run (bouwen en starten), test of clean'),
    project: z.string().optional().describe('Pad van het .xcodeproj of .xcworkspace, zoals xcode_projects het geeft'),
    scheme: z.string().optional(),
    configuration: z.string().optional().describe('Bv. Debug of Release'),
    destination: z.string().optional().describe('Id van een simulator of toestel, of "generic:<platform>" (bv. "generic:iOS")'),
    wait: z.boolean().optional().describe('Wachten tot het klaar is (hooguit 4 minuten) en de laatste regels en de exitcode teruggeven; niet bij run (de app blijft draaien)'),
  },
  run: (args, context) => runAction(args, context),
});
