const optimism = jest.requireActual('optimism');
module.exports = {
  ...optimism,
  wrap: jest.fn(optimism.wrap),
};
