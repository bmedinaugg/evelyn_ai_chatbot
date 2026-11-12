export const en = {
  common: {
    error: {
      generic: 'Something went wrong. Please try again.',
    },
    greeting: 'Hi {name}!',
  },
  // Fixed bot replies: shown instead of model-written text in these situations.
  bot: {
    noMatch:
      "I couldn't find a reliable answer to that in our help articles. Our support team can help you further.",
    offTopic:
      'I can only help with questions about TrainMore. Is there something about your membership or our clubs I can help with?',
    accountQuestion:
      "I can't look up personal account details here yet. Our support team can help you with your account.",
    loginNeeded:
      'To answer questions about your account, please log in first with your email address.',
    wantsHuman: 'Of course. You can reach our support team via the contact page.',
    error: 'Something went wrong on our side. Please try again in a moment.',
    conversationLimit: 'This conversation has reached its limit. Please start a new chat.',
    greeting: 'Hi! How can I help you today?',
    salesLead:
      "Great that you're interested in joining TrainMore! Leave your details in the form below and our team will contact you.",
  },
  widget: {
    title: 'TrainMore support',
    subtitle: 'Ask your question, we answer from our help articles.',
    open: 'Open chat',
    close: 'Close chat',
    newChat: 'New chat',
    consent: {
      text: 'This chat uses AI to answer your questions based on our help articles. Please do not share sensitive personal data. Your messages are stored to answer you and to improve our service.',
      privacy: 'Privacy statement',
      accept: 'I understand, start chat',
    },
    input: {
      placeholder: 'Ask your question…',
      send: 'Send',
    },
    typing: 'Looking it up…',
    sources: 'Sources',
    contact: 'Contact our support team',
    errors: {
      network: 'No connection. Please try again.',
      busy: "I'm still working on your previous question.",
      rateLimited: "You're sending messages quickly. Please wait a moment.",
      tooLong: 'Your message is too long (max 1,000 characters).',
    },
    login: {
      title: 'Log in',
      intro: "We'll email you a 6-digit code.",
      email: 'Email address',
      sendCode: 'Send code',
      codeSent: 'We sent a code to your email address. Enter it below.',
      code: 'Code',
      verify: 'Log in',
      newCode: 'Send a new code',
      invalidCode: 'That code is not correct.',
      locked: 'Too many attempts. Please request a new code.',
      expired: 'This code has expired or was already used. Please request a new code.',
      lookupFailed: "We couldn't load your account right now.",
      retry: 'Try again',
      chooseAccount: 'Which membership is your question about?',
      loggedIn: 'You are logged in ({club}).',
      noAccount: "You're logged in, but we couldn't find a membership for this email address.",
      cancel: 'Cancel',
    },
    status: {
      MEMBER: 'Member',
      PROSPECT: 'Prospect',
      FORMER_MEMBER: 'Former member',
    },
    lead: {
      title: 'Become a member',
      email: 'Email address',
      phone: 'Phone number (optional)',
      question: 'Your question',
      consent: 'TrainMore may contact me about my question.',
      submit: 'Send',
      sending: 'Sending…',
      success: "Thanks! We've received your question and will get back to you by email.",
      verificationFailed: "We couldn't verify that you're not a robot. Please try again.",
      error: 'Something went wrong. Please try again later.',
      cancel: 'Cancel',
      invalid: 'Please check your email address, phone number and question.',
      unavailable:
        'The verification could not load. Please try again later or contact our support team.',
    },
  },
  email: {
    loginCode: {
      subject: 'Your TrainMore login code',
      body: "Your code is {code}. It is valid for {minutes} minutes.\n\nDidn't request this? You can ignore this email.",
    },
  },
  lead: {
    subject: 'New membership question via website chat',
  },
};
