process.on('unhandledRejection', (error) => {
    console.error('Unhandled Promise Rejection:', error);
    process.exit(1);
});

const { mapLimit } = require('async');
const { processCardPayment } = require('./fp')
const fs = require("fs");


async function main() {
    const bearer = fs.readFileSync('./bearer.txt', 'utf-8');
    const postfields = JSON.parse(fs.readFileSync('./postfields.json', 'utf-8'));

    let cards = [
        '5424821357096169|04|2029'
    ];
    mapLimit(cards, 14, async (card) => {
        await processCardPayment(bearer, postfields, card);
    })
}

main();
