#!/usr/bin/env node

console.error('==== DEBUG INFORMATION ====');
console.error('ARGUMENTS:', process.argv);
// Names and lengths only: the environment holds the client secret (#278).
console.error('ENVIRONMENT VARIABLES:');
Object.keys(process.env).forEach((key) => {
  console.error(`  ${key}: <set, ${process.env[key].length} chars>`);
});
console.error('==== END DEBUG INFO ====');

// Load the real application
try {
  require('./index');
} catch (error) {
  console.error('ERROR LOADING INDEX.JS:', error);
}
