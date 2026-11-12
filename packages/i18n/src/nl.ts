import type { Messages } from './types.ts';

export const nl = {
  common: {
    error: {
      generic: 'Er ging iets mis. Probeer het opnieuw.',
    },
    greeting: 'Hoi {name}!',
  },
  bot: {
    noMatch:
      'Ik kon hier geen betrouwbaar antwoord op vinden in onze helpartikelen. Ons supportteam helpt je graag verder.',
    offTopic:
      'Ik kan alleen helpen met vragen over TrainMore. Kan ik je helpen met iets over je lidmaatschap of onze clubs?',
    accountQuestion:
      'Ik kan hier nog geen persoonlijke accountgegevens opzoeken. Ons supportteam helpt je graag met je account.',
    wantsHuman: 'Natuurlijk. Je kunt ons supportteam bereiken via de contactpagina.',
    error: 'Er ging aan onze kant iets mis. Probeer het zo nog eens.',
    conversationLimit: 'Dit gesprek heeft de limiet bereikt. Start een nieuwe chat.',
    greeting: 'Hoi! Waarmee kan ik je helpen?',
    salesLead:
      'Leuk dat je interesse hebt in TrainMore! Laat je gegevens achter in het formulier hieronder, dan neemt ons team contact met je op.',
  },
  lead: {
    subject: 'Nieuwe lidmaatschapsvraag via websitechat',
  },
} satisfies Messages;
