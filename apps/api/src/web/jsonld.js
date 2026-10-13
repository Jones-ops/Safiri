/**
 * Structured data (JSON-LD) for the public pages. Checked against the schema.org vocabulary
 * in test/jsonld.test.js, which mirrors the Schema.org validator's errors.
 *
 * A package is typed ["Product", "TouristTrip"]: TouristTrip describes the trip and its
 * itinerary, and Product is what allows offers, aggregateRating and review (TouristTrip on
 * its own does not accept ratings or reviews, so the validator would flag them).
 */
const { formatAmount, instalmentPreview } = require('@safiri/shared');
const { localised } = require('./i18n');

const CONTEXT = 'https://schema.org';

function organisation(base) {
  return {
    '@type': 'Organization',
    '@id': `${base}/#organization`,
    name: 'Safiri',
    url: `${base}/`,
    logo: `${base}/static/icon.png`,
  };
}

function breadcrumbs(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url })),
  };
}

function faqPage(url, faq) {
  if (!faq?.length) return null;
  return {
    '@type': 'FAQPage',
    '@id': `${url}#faq`,
    mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

function geo(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) ? { '@type': 'GeoCoordinates', latitude: lat, longitude: lng } : undefined;
}

function homeGraph({ base, packages, lang }) {
  return {
    '@context': CONTEXT,
    '@graph': [
      organisation(base),
      { '@type': 'WebSite', '@id': `${base}/#website`, url: `${base}/`, name: 'Safiri', inLanguage: lang, publisher: { '@id': `${base}/#organization` } },
      {
        '@type': 'ItemList',
        itemListElement: packages.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${base}/p/${p.slug}`, name: localised(p, 'title', lang) })),
      },
    ],
  };
}

function destinationGraph({ base, destination, packages, lang, t, image }) {
  const url = `${base}/d/${destination.slug}`;
  return {
    '@context': CONTEXT,
    '@graph': [
      {
        '@type': 'TouristDestination',
        '@id': `${url}#place`,
        name: destination.name,
        description: localised(destination, 'summary', lang),
        url,
        image: image || undefined,
        geo: geo(destination.lat, destination.lng),
        address: { '@type': 'PostalAddress', addressRegion: destination.region, addressCountry: 'KE' },
      },
      {
        '@type': 'ItemList',
        name: t('destination.packages', { name: destination.name }),
        itemListElement: packages.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${base}/p/${p.slug}`, name: localised(p, 'title', lang) })),
      },
      breadcrumbs([[t('web.home'), `${base}/`], [destination.name, url]]),
      faqPage(url, localised(destination, 'faq', lang)),
    ].filter(Boolean),
  };
}

function packageGraph({ base, pkg, lang, t, image }) {
  const url = `${base}/p/${pkg.slug}`;
  const d = pkg.destination;
  const agencyId = `${url}#agency`;
  const stays = [...new Map(pkg.items.filter((i) => i.kind === 'stay').map((i) => [i.provider.name, i.provider])).values()];
  const preview = instalmentPreview({ totalKes: pkg.fromPriceKes, depositPct: pkg.depositPct, instalmentCount: pkg.instalments });

  const trip = {
    '@type': ['Product', 'TouristTrip'],
    '@id': `${url}#trip`,
    name: localised(pkg, 'title', lang),
    description: localised(pkg, 'summary', lang),
    url,
    image: image || undefined,
    sku: pkg.slug,
    brand: { '@type': 'Brand', name: 'Safiri' },
    provider: pkg.agency ? { '@id': agencyId } : undefined,
    itinerary: {
      '@type': 'ItemList',
      numberOfItems: pkg.items.length,
      itemListElement: pkg.items.map((item, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: `${t('pkg.day', { n: item.day })}: ${item.title}`,
      })),
    },
    offers: {
      '@type': 'Offer',
      price: pkg.fromPriceKes,
      priceCurrency: 'KES',
      availability: 'https://schema.org/InStock',
      url,
      seller: pkg.agency ? { '@id': agencyId } : { '@id': `${base}/#organization` },
      description: preview
        ? t('price.orInstalments', { times: preview.times, amount: formatAmount(preview.amountKes) })
        : undefined,
    },
  };

  if (pkg.reviews.length) {
    const avg = pkg.reviews.reduce((s, r) => s + r.rating, 0) / pkg.reviews.length;
    trip.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Math.round(avg * 10) / 10,
      reviewCount: pkg.reviews.length,
      bestRating: 5,
      worstRating: 1,
    };
    trip.review = pkg.reviews.slice(0, 5).map((r) => ({
      '@type': 'Review',
      reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5, worstRating: 1 },
      author: { '@type': 'Person', name: t('pkg.verifiedTraveller') },
      datePublished: r.createdAt.slice(0, 10),
      reviewBody: r.body || undefined,
    }));
  }

  return {
    '@context': CONTEXT,
    '@graph': [
      trip,
      pkg.agency ? { '@type': 'TravelAgency', '@id': agencyId, name: pkg.agency.name, address: { '@type': 'PostalAddress', addressCountry: 'KE' } } : null,
      ...stays.map((s) => ({
        '@type': 'LodgingBusiness',
        name: s.name,
        address: { '@type': 'PostalAddress', addressLocality: d.name, addressRegion: d.region, addressCountry: 'KE' },
        geo: geo(s.lat, s.lng) || geo(d.lat, d.lng),
      })),
      breadcrumbs([[t('web.home'), `${base}/`], [d.name, `${base}/d/${d.slug}`], [localised(pkg, 'title', lang), url]]),
      faqPage(url, localised(d, 'faq', lang)),
    ].filter(Boolean),
  };
}

module.exports = { homeGraph, destinationGraph, packageGraph };
