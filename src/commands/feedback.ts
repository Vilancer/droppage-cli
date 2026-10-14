import type { Command } from 'commander';
import pkg from '../../package.json' with { type: 'json' };
import { emailSchema } from '../services/auth.js';
import { submitFeedback, type FeedbackKind } from '../services/feedback.js';

function isKind(value: string): value is FeedbackKind {
  return value === 'idea' || value === 'bug' || value === 'review' || value === 'other';
}

export function registerFeedback(program: Command): void {
  program
    .command('feedback')
    .description('Send an idea, bug report, review, or other feedback')
    .argument('<message>', 'feedback message (3–4000 characters)')
    .option('--kind <kind>', 'idea, bug, review, or other', 'other')
    .option('--agent [model]', 'identify this feedback as coming from an agent')
    .option('--contact <email>', 'optional reply-to email address')
    .option('--rating <rating>', 'optional 1–5 rating for a review')
    .option('--allow-quote', 'allow this review to be quoted publicly (never publishes automatically)')
    .action(async (
      message: string,
      options: { kind: string; agent?: boolean | string; contact?: string; rating?: string; allowQuote?: boolean },
    ) => {
      const cleanedMessage = message.trim();
      const model = typeof options.agent === 'string' ? options.agent.trim() : undefined;
      const contact = options.contact?.trim().toLowerCase();
      if (cleanedMessage.length < 3 || cleanedMessage.length > 4000) {
        console.error('droppage: feedback must be between 3 and 4000 characters');
        process.exitCode = 1;
        return;
      }
      if (!isKind(options.kind)) {
        console.error('droppage: --kind must be idea, bug, review, or other');
        process.exitCode = 1;
        return;
      }
      if (model && model.length > 120) {
        console.error('droppage: agent model must be 120 characters or fewer');
        process.exitCode = 1;
        return;
      }
      if (contact && !emailSchema.safeParse(contact).success) {
        console.error(`droppage: invalid contact email: ${contact}`);
        process.exitCode = 1;
        return;
      }
      const rating = options.rating === undefined ? undefined : Number(options.rating);
      if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
        console.error('droppage: --rating must be a whole number from 1 to 5');
        process.exitCode = 1;
        return;
      }
      if (options.kind !== 'review' && (rating !== undefined || options.allowQuote)) {
        console.error('droppage: --rating and --allow-quote require --kind review');
        process.exitCode = 1;
        return;
      }

      try {
        const result = await submitFeedback({
          message: cleanedMessage,
          kind: options.kind,
          actor: options.agent === undefined ? 'human' : 'agent',
          ...(model ? { model } : {}),
          ...(contact ? { contact } : {}),
          ...(rating !== undefined ? { rating } : {}),
          ...(options.allowQuote ? { testimonial_consent: true } : {}),
          source: 'cli',
          cli_version: pkg.version,
        });
        process.stdout.write(`${result.id}\n`);
        console.error('droppage: thanks — your feedback was sent.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`droppage: feedback failed: ${message}`);
        process.exitCode = 1;
      }
    });
}
