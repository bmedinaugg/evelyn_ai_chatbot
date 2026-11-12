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
    loginNeeded: 'Om vragen over je account te beantwoorden, log je eerst in met je e-mailadres.',
    wantsHuman:
      'Natuurlijk. Vul het formulier hieronder in, dan neemt ons supportteam per e-mail contact met je op.',
    stuck:
      'Sorry, ik kom er niet uit. Vul het formulier hieronder in, dan neemt ons supportteam per e-mail contact met je op.',
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
    login: {
      title: 'Inloggen',
      intro: 'We mailen je een code van 6 cijfers.',
      email: 'E-mailadres',
      sendCode: 'Code versturen',
      codeSent: 'We hebben een code naar je e-mailadres gestuurd. Vul hem hieronder in.',
      code: 'Code',
      verify: 'Inloggen',
      newCode: 'Nieuwe code sturen',
      invalidCode: 'Die code klopt niet.',
      locked: 'Te veel pogingen. Vraag een nieuwe code aan.',
      expired: 'Deze code is verlopen of al gebruikt. Vraag een nieuwe code aan.',
      lookupFailed: 'We konden je account nu niet ophalen.',
      retry: 'Opnieuw proberen',
      chooseAccount: 'Over welk lidmaatschap gaat je vraag?',
      loggedIn: 'Je bent ingelogd ({club}).',
      noAccount: 'Je bent ingelogd, maar we vonden geen lidmaatschap bij dit e-mailadres.',
      cancel: 'Annuleren',
    },
    status: {
      MEMBER: 'Lid',
      PROSPECT: 'Geïnteresseerde',
      FORMER_MEMBER: 'Oud-lid',
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
  email: {
    loginCode: {
      subject: 'Je TrainMore-inlogcode',
      body: 'Je code is {code}. Deze is {minutes} minuten geldig.\n\nHeb je dit niet aangevraagd? Dan kun je deze e-mail negeren.',
    },
  },
  lead: {
    subject: 'Nieuwe lidmaatschapsvraag via websitechat',
  },
  ticket: {
    noteTitle: 'Chatbot-gesprek (laatste berichten)',
    topic: 'Onderwerp: {topic}',
    account: 'Account: {status}, {club} (geverifieerd via e-mailcode)',
    notLoggedIn: 'Account: niet ingelogd',
    customer: 'Klant',
    bot: 'Chatbot',
    topics: {
      membership: 'Lidmaatschap & contract',
      payments: 'Betalingen & facturen',
      club: 'Club & faciliteiten',
      app: 'App & account',
    },
  },
} satisfies Messages;
