import { SITE } from './site';

const ORG_ID = `${SITE.url}/#organization`;
const LOCAL_ID = `${SITE.url}/#localbusiness`;
const SITE_ID = `${SITE.url}/#website`;
const FOUNDER_ID = `${SITE.url}/about#founder`;
const socialProfiles = Object.values(SITE.social).filter(Boolean).map(String);
const founderProfiles = Object.values(SITE.founder).filter(
  (value) => typeof value === 'string' && value.startsWith('https://'),
).map(String);

export const organizationGraph = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': ORG_ID,
      name: SITE.name,
      alternateName: SITE.shortName,
      url: SITE.url,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE.url}/pib-logo-512.png`,
        width: 512,
        height: 512,
      },
      foundingDate: SITE.founded,
      founder: { '@id': FOUNDER_ID },
      email: SITE.email,
      description: SITE.description,
      sameAs: socialProfiles,
      contactPoint: [
        {
          '@type': 'ContactPoint',
          email: SITE.email,
          telephone: SITE.phone,
          contactType: 'customer support',
          areaServed: ['ZA', 'GB', 'US', 'EU'],
          availableLanguage: ['English'],
        },
      ],
    },
    {
      '@type': 'LocalBusiness',
      '@id': LOCAL_ID,
      name: SITE.name,
      image: `${SITE.url}/og/default.png`,
      url: SITE.url,
      telephone: SITE.phone,
      email: SITE.email,
      priceRange: 'R',
      address: {
        '@type': 'PostalAddress',
        ...SITE.address,
      },
      geo: {
        '@type': 'GeoCoordinates',
        ...SITE.geo,
      },
      openingHoursSpecification: [
        {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          opens: '08:00',
          closes: '17:00',
        },
      ],
      areaServed: [
        { '@type': 'Country', name: 'South Africa' },
        { '@type': 'Country', name: 'United Kingdom' },
        { '@type': 'Country', name: 'United States' },
      ],
      parentOrganization: { '@id': ORG_ID },
    },
    {
      '@type': 'WebSite',
      '@id': SITE_ID,
      url: SITE.url,
      name: SITE.name,
      publisher: { '@id': ORG_ID },
      inLanguage: SITE.language,
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${SITE.url}/search?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'Person',
      '@id': FOUNDER_ID,
      name: SITE.founder.name,
      jobTitle: SITE.founder.role,
      worksFor: { '@id': ORG_ID },
      sameAs: founderProfiles,
    },
  ],
};

export function serviceSchema(opts: {
  slug: string;
  name: string;
  description: string;
  priceFrom?: number;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${SITE.url}/services/${opts.slug}#service`,
    name: opts.name,
    description: opts.description,
    serviceType: opts.name,
    provider: { '@id': ORG_ID },
    areaServed: [{ '@type': 'Country', name: 'South Africa' }, { '@type': 'Country', name: 'Worldwide' }],
    url: `${SITE.url}/services/${opts.slug}`,
    ...(opts.priceFrom && {
      offers: {
        '@type': 'Offer',
        priceCurrency: 'ZAR',
        price: opts.priceFrom,
        priceSpecification: {
          '@type': 'PriceSpecification',
          minPrice: opts.priceFrom,
          priceCurrency: 'ZAR',
        },
        availability: 'https://schema.org/InStock',
      },
    }),
  };
}

export function breadcrumbSchema(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url.startsWith('http') ? item.url : `${SITE.url}${item.url}`,
    })),
  };
}

export function faqSchema(faqs: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

export function articleSchema(opts: {
  slug: string;
  title: string;
  description: string;
  image: string;
  datePublished: string;
  dateModified?: string;
  authorName?: string;
  section?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: opts.title,
    description: opts.description,
    image: opts.image.startsWith('http') ? opts.image : `${SITE.url}${opts.image}`,
    datePublished: opts.datePublished,
    dateModified: opts.dateModified ?? opts.datePublished,
    author: { '@type': 'Person', name: opts.authorName ?? SITE.founder.name, '@id': FOUNDER_ID },
    publisher: { '@id': ORG_ID },
    articleSection: opts.section,
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE.url}/${opts.slug}` },
  };
}

export function caseStudySchema(opts: {
  slug: string;
  title: string;
  description: string;
  image: string;
  client: string;
  datePublished: string;
}) {
  return articleSchema({
    ...opts,
    section: 'Case study',
  });
}

export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
