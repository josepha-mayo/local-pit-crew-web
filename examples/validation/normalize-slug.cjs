'use strict';

exports.normalizeSlug = input => {
 const slug = input?.slug;
 if (typeof slug !== 'string' || !/^[a-z0-9-]+$/i.test(slug.trim())) {
  throw Object.assign(new TypeError('Enter a project slug'), {code: 'INVALID_SLUG'});
 }
 return slug.trim().toLowerCase();
};
