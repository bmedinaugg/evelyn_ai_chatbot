import type { components } from '@trainmore/magicline';

type StudioInformation = components['schemas']['StudioInformation'];

/** Synthetic studios matching the profiles' studioIds. */
export const studios: StudioInformation[] = [
  {
    studioId: 1001,
    name: 'TrainMore Amsterdam (test)',
    accessCodeConfiguration: {} as StudioInformation['accessCodeConfiguration'],
  },
  {
    studioId: 1002,
    name: 'TrainMore Utrecht (test)',
    accessCodeConfiguration: {} as StudioInformation['accessCodeConfiguration'],
  },
];
