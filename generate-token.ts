import { generateSSOToken } from './lib/jwt-utils';

const token = generateSSOToken('test-user-id', 'test-location-id', 'test@example.com');
console.log(token);
