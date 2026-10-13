module.exports = {
  ...require('./money'),
  ...require('./phone'),
  ...require('./constants'),
  ...require('./schemas'),
  ...require('./analytics'),
  ...require('./catalogue'),
  ...require('./trip'),
  i18n: require('./i18n'),
};
