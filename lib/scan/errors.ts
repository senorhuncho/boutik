/** Request errors the API turns into 4xx replies. Kept apart from the Next.js helpers so plain modules and tests can use them. */
export class BadRequest extends Error {}
export class Locked extends Error {}
