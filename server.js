const express = require('express');
const path = require('path');
const { processCardPayment } = require('./fp');
const { mapLimit } = require('async');

const app = express();
const PORT = 3000;

// Middleware - JSON parsing must come before static files
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes should be defined before static files

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API endpoint to process payment
app.post('/api/process-payment', async (req, res) => {
    try {
        const { bearer, card, postfields } = req.body;

        if (!bearer || !card || !postfields) {
            return res.status(400).json({ 
                error: 'Missing required fields: bearer, card, and postfields are required' 
            });
        }

        // Validate card format
        const cardParts = card.split('|');
        if (cardParts.length !== 3) {
            return res.status(400).json({ 
                error: 'Invalid card format. Expected: cardNumber|MM|YYYY' 
            });
        }

        console.log(`Processing payment for card: ${cardParts[0].substring(0, 4)}****${cardParts[0].substring(12)}`);

        // Process the payment and get result with logs
        const result = await processCardPayment(bearer, postfields, card);

        // Return the result with logs
        res.json({
            success: result.success || false,
            message: result.message || result.error || 'Payment processing completed',
            logs: result.logs || [],
            card: cardParts[0].substring(0, 4) + '****' + cardParts[0].substring(12),
            requires3DS: result.requires3DS || false,
            merchantUrl: result.merchantUrl || null,
            error: result.error || null
        });

    } catch (error) {
        console.error('Error processing payment:', error);
        res.status(500).json({ 
            error: 'Internal server error', 
            message: error.message 
        });
    }
});

// API endpoint to process multiple cards (batch processing)
app.post('/api/process-batch', async (req, res) => {
    try {
        const { bearer, cards, postfields, concurrency = 14 } = req.body;

        if (!bearer || !cards || !Array.isArray(cards) || cards.length === 0 || !postfields) {
            return res.status(400).json({ 
                error: 'Missing required fields: bearer, cards (array), and postfields are required' 
            });
        }

        // Validate all cards format
        const validCards = [];
        const invalidCards = [];
        
        cards.forEach((card, index) => {
            const trimmedCard = card.trim();
            if (!trimmedCard) return; // Skip empty lines
            
            const cardParts = trimmedCard.split('|');
            if (cardParts.length === 3) {
                validCards.push(trimmedCard);
            } else {
                invalidCards.push({ index: index + 1, card: trimmedCard });
            }
        });

        if (invalidCards.length > 0) {
            return res.status(400).json({ 
                error: 'Invalid card format(s) found',
                invalidCards: invalidCards,
                message: `Found ${invalidCards.length} invalid card(s). Each card must be in format: cardNumber|MM|YYYY`
            });
        }

        if (validCards.length === 0) {
            return res.status(400).json({ 
                error: 'No valid cards provided' 
            });
        }

        console.log(`Processing ${validCards.length} cards with concurrency of ${concurrency}`);

        // Process cards with mapLimit (similar to run.js)
        const results = [];
        let completed = 0;
        
        await mapLimit(validCards, parseInt(concurrency) || 14, async (card) => {
            try {
                const result = await processCardPayment(bearer, postfields, card);
                completed++;
                
                const cardParts = card.split('|');
                const maskedCard = cardParts[0].substring(0, 4) + '****' + cardParts[0].substring(12);
                
                results.push({
                    card: maskedCard,
                    fullCard: card,
                    success: result.success || false,
                    message: result.message || result.error || 'Processing completed',
                    error: result.error || null,
                    requires3DS: result.requires3DS || false,
                    merchantUrl: result.merchantUrl || null,
                    logs: result.logs || []
                });
                
                // Send progress update via Server-Sent Events would be better, but for now we'll return all at once
                console.log(`[${completed}/${validCards.length}] Completed: ${maskedCard}`);
            } catch (error) {
                completed++;
                const cardParts = card.split('|');
                const maskedCard = cardParts[0] ? (cardParts[0].substring(0, 4) + '****' + cardParts[0].substring(12)) : 'Unknown';
                
                results.push({
                    card: maskedCard,
                    fullCard: card,
                    success: false,
                    message: 'Error processing card',
                    error: error.message,
                    logs: []
                });
                
                console.error(`Error processing card ${maskedCard}:`, error.message);
            }
        });

        // Calculate summary
        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length;

        res.json({
            success: true,
            total: validCards.length,
            completed: completed,
            successCount: successCount,
            failureCount: failureCount,
            results: results
        });

    } catch (error) {
        console.error('Error processing batch:', error);
        res.status(500).json({ 
            error: 'Internal server error', 
            message: error.message 
        });
    }
});

// Static files should be served last (after API routes)
app.use(express.static(__dirname));

// Catch-all for undefined routes (must be last)
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'API endpoint not found', path: req.path });
    } else {
        res.status(404).sendFile(path.join(__dirname, 'index.html'));
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Open your browser and navigate to http://localhost:${PORT}`);
});

