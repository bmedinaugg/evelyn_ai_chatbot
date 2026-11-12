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
  widget: {
    title: 'TrainMore support',
    subtitle: 'Stel je vraag, we antwoorden op basis van onze helpartikelen.',
    open: 'Chat openen',
    close: 'Chat sluiten',
    newChat: 'Nieuwe chat',
    consent: {
      text: 'Deze chat gebruikt AI om je vragen te beantwoorden op basis van onze helpartikelen. Deel geen gevoelige persoonsgegevens. We bewaren je berichten om je te helpen en onze service te verbeteren.',
      privacy: 'Privacyverklaring',
      accept: 'Begrepen, start de chat',
    },
    input: {
      placeholder: 'Stel je vraag…',
      send: 'Versturen',
    },
    typing: 'Even zoeken…',
    sources: 'Bronnen',
    contact: 'Neem contact op met ons supportteam',
    errors: {
      network: 'Geen verbinding. Probeer het opnieuw.',
      busy: 'Ik ben nog bezig met je vorige vraag.',
      rateLimited: 'Je stuurt snel berichten. Wacht even.',
      tooLong: 'Je bericht is te lang (max. 1.000 tekens).',
    },
    lead: {
      title: 'Lid worden',
      email: 'E-mailadres',
      phone: 'Telefoonnummer (optioneel)',
      question: 'Je vraag',
      consent: 'TrainMore mag contact met me opnemen over mijn vraag.',
      submit: 'Versturen',
      sending: 'Bezig met versturen…',
      success: 'Bedankt! We hebben je vraag ontvangen en reageren per e-mail.',
      verificationFailed: 'We konden niet controleren dat je geen robot bent. Probeer het opnieuw.',
      error: 'Er ging iets mis. Probeer het later opnieuw.',
      cancel: 'Annuleren',
      invalid: 'Controleer je e-mailadres, telefoonnummer en vraag.',
      unavailable:
        'De controle kon niet laden. Probeer het later opnieuw of neem contact op met ons supportteam.',
    },
  },
  lead: {
    subject: 'Nieuwe lidmaatschapsvraag via websitechat',
  },
} satisfies Messages;
