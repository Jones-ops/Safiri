module.exports = {
  ...require('./money'),
  ...require('./phone'),
  ...require('./constants'),
  ...require('./schemas'),
  ...require('./analytics'),
  ...require('./catalogue'),
  i18n: require('./i18n'),
};
