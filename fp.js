const axios = require('axios');
const fs = require('fs')
const { URLSearchParams } = require('url');
const { mapLimit } = require('async')

// Load encrypt function with error handling
let encrypt;
try {
    const encryptModule = require('./encrypt');
    encrypt = encryptModule.encrypt;
    if (!encrypt || typeof encrypt !== 'function') {
        throw new Error('encrypt function not found in encrypt.js module');
    }
} catch (error) {
    console.error('Error loading encrypt module:', error);
    throw new Error('Failed to load encrypt module. Make sure encrypt.js exists in the project root.');
}

const DEBUG = false;
async function debug_log(...args) {
    if (DEBUG === true) {
        console.log(...args);
    }
}

/**
 * Gets the substring in between two delimiters.
 *
 * @param {string} string The input string to search within.
 * @param {string} left The left (starting) delimiter.
 * @param {string} right The right (ending) delimiter.
 * @returns {string} The substring found between the delimiters, or an empty string if not found.
 */
function getString(string, left, right) {
    // 1. Find the index of the left delimiter
    const startIndex = string.indexOf(left);

    // If the left delimiter is not found, return an empty string
    if (startIndex === -1) {
        return "";
    }

    // Calculate the starting position of the desired substring
    // We want to start immediately AFTER the left delimiter
    const contentStartIndex = startIndex + left.length;

    // 2. Search for the right delimiter starting from AFTER the left delimiter
    const endIndex = string.indexOf(right, contentStartIndex);

    // If the right delimiter is not found, or it appears before the content start, return an empty string
    // (The second condition 'endIndex < contentStartIndex' is implicitly handled if the first condition 'endIndex === -1' fails,
    // but it's good practice to ensure the right delimiter comes after the left one's end)
    if (endIndex === -1) {
        return "";
    }

    // 3. Extract the substring
    // slice(start, end) extracts up to, but not including, the 'end' index.
    return string.slice(contentStartIndex, endIndex);
}

async function processCardPayment(bearer, postfields, card) {
    // Array to store all logs
    const logs = [];
    const log = (message, type = 'info') => {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = { timestamp, message, type };
        logs.push(logEntry);
        console.log(`[${timestamp}] ${message}`);
        return logEntry;
    };

    let foodpandaHeaders = {
        'Authorization': 'Bearer ' + bearer,
        'User-Agent': 'foodpanda/8.26.0 (iPhone; iOS 17.4.1; Scale/3.00)',
        'X-Fp-Api-Key': 'iphone',
        'X-Pd-Language-Id': 1,
        'Origin': 'https://www.foodpanda.ph',
        'Referer': 'https://www.foodpanda.ph/',
    }

    let customerData;
    debug_log('Getting customer data')
    try {
        log('Getting customer data...', 'info');
        const customerDataResponse = await axios.get(
            'https://ph.fd-api.com/api/v5/customers',
            {
                headers: foodpandaHeaders
            }
        );
        customerData = customerDataResponse.data;
    } catch (error) {
        if (error.response && error.response.data && error.response.data.message === 'Unauthorized') {
            const msg = 'Error: Bearer token is expired or invalid.';
            log(msg, 'error');
            return { success: false, logs, error: msg };
        } else {
            const msg = 'Error in getting customer data!';
            log(msg, 'error');
            return { success: false, logs, error: msg };
        }
    }
    let { email, first_name, last_name } = customerData.data;
    let fullName = first_name + " " + last_name;
    log(`Customer Name: ${fullName}, Email: ${email}`, 'success');


    let intentPostfields = {
        "subtotal": postfields.expected_total_amount,
        "currency": "PHP",
        "vendorCode": postfields.vendor.code,
        "amount": postfields.expected_total_amount,
        "emoneyAmountToUse": 0,
        "expeditionType": "delivery",
        "paymentLimits": []
    };

    let amount = postfields.expected_total_amount;

    log(`Creating payment intent with amount: ${intentPostfields.subtotal} ${intentPostfields.currency}`, 'info');
    let purchaseIntent;
    try {
        const purchaseIntentResponse = await axios.post(
            'https://ph.fd-api.com/api/v5/purchase/intent?include=cashback&locale=en_PH&fast-top-up=false',
            intentPostfields,
            {
                headers: foodpandaHeaders
            }
        )
        purchaseIntent = purchaseIntentResponse.data.data.purchaseIntent.id
        log(`Payment Intent ID: ${purchaseIntent}`, 'success');
    } catch (error) {
        const msg = 'Error creating payment intent';
        log(msg, 'error');
        log(error.response ? JSON.stringify(error.response.data) : error.message, 'error');
        return { success: false, logs, error: msg };
    }


    log('Getting Context KEYID...', 'info');
    let context;
    try {
        context = await axios.get(
            'https://bruce-fp-ph.production.asia.fintech.deliveryhero.com/credit-card/add?bruceOwnerData=%7B%22provider%22%3A%22checkout%22%2C%22countryCode%22%3A%22PH%22%2C%22paymentContext%22%3A%22restaurants%22%2C%22vendorId%22%3A%22' + postfields.vendor.code + '%22%2C%22intentId%22%3A%22' + purchaseIntent + '%22%7D&bruceOwnerType=Purchase&tokenization_showcheckbox=true&country_code=ph&language_code=en&show_save_button=false&source=web&target_origin=https%3A%2F%2Fwww.foodpanda.ph&tokenize=true&vendor_code=' + postfields.vendor.code
        )
    } catch (error) {
        const msg = 'Error getting context KEYID';
        log(msg, 'error');
        log(error.response ? JSON.stringify(error.response.data) : error.message, 'error');
        return { success: false, logs, error: msg };
    }

    let data, key;
log('Extracting encryption key...', 'info');
try {
    data = atob(getString(context.data, "__PROVIDER_PROPS__='", "'</script"));

    // ===== ADDED: sanitize decoded string before JSON.parse =====
    const jsonStart = data.indexOf('{');
    const jsonEnd = data.lastIndexOf('}') + 1;

    if (jsonStart !== -1 && jsonEnd !== -1) {
        data = data.slice(jsonStart, jsonEnd);
    }
    // ============================================================

    data = JSON.parse(data);
    key = data.config.keyId
    log('Encryption key obtained', 'success');
} catch (e) {
    const msg = 'Failed to parse key from context.';
    log(msg, 'error');
    return { success: false, logs, error: msg };
}

    let [cc, mm, yyyy] = card.split("|");
    let m;
    if (mm[0] === '0') {
        m = mm.replace('0', '');
    } else {
        m = mm
    }
    let bin = cc.substr(0, 6);
    let last4 = cc.substr(12, 16);
    let cardType = bin[0] === '4' ? 'Visa' : 'Mastercard'


    log('Encrypting card data...', 'info');
    let encryptedCard;
    try {
        encryptedCard = await encrypt(purchaseIntent, cc, key);
        log('Card encrypted successfully', 'success');
    } catch (e) {
        const msg = 'Error encrypting card data';
        log(msg, 'error');
        return { success: false, logs, error: msg };
    }
    
    let cardData = JSON.parse(JSON.stringify(postfields)); // Deep copy
    cardData.payment.methods = [
        {
            "amount": amount,
            "metadata": {
                "type": "encrypted",
                "card": {
                    "tokenize": false,
                    "token": "",
                    "encrypted": encryptedCard,
                    "scheme": cardType,
                    "last_4_digits": last4,
                    "card_bank_identification_number": bin,
                    "valid_to_month": parseInt(m),
                    "valid_to_year": parseInt(yyyy),
                    "holder_name": fullName
                },
                "screenHeight": 1080,
                "screenWidth": 1920
            },
            "method": "generic_creditcard"
        }
    ];
    cardData.bypass_duplicate_order_check = true;
    cardData.platform = "com.global.foodpanda.ios_243200084";
    cardData.source = "ios";
    cardData.payment.currency = "PHP";
    cardData.payment.purchase_intent_id = purchaseIntent;

    try {
        const checkoutResponse = await axios.post(
            'https://ph.fd-api.com/api/v5/cart/checkout',
            cardData,
            {
                headers: foodpandaHeaders
            }
        );

        const checkoutResult = checkoutResponse.data;
        const { id, payment } = checkoutResult;
        const purchaseId = payment.purchase_id;

        log(`Order ID: ${id}`, 'success');
        log(`Purchase ID: ${purchaseId}`, 'success');

        log('Checking payment status...', 'info');
        let attempt = 1;
        let paymentStatusData;
        while (true) {
            log(`Checking payment status, attempt ${attempt}...`, 'info');
            try {
                await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
                const paymentStatusResponse = await axios.get(
                    `https://ph.fd-api.com/api/v5/payment/status?purchaseId=${purchaseId}&platformReferenceId=${id}&attempt=${attempt}`,
                    { headers: foodpandaHeaders }
                );
                paymentStatusData = paymentStatusResponse.data;

                if (paymentStatusData.status !== 'pending' || (paymentStatusData.action && paymentStatusData.action.details && paymentStatusData.action.details.url)) {
                    break;
                }
            } catch (error) {
                const msg = 'Error checking payment status';
                log(msg, 'error');
                log(error.response ? JSON.stringify(error.response.data) : error.message, 'error');
                return { success: false, logs, error: msg };
            }
            if (attempt > 10) {
                const msg = 'Payment status check timed out.';
                log(msg, 'error');
                return { success: false, logs, error: msg };
            }
            attempt++;
        }

        if (paymentStatusData.status === 'Success') {
            const msg = `[SUCCESS] Card: ${card} | Foodpanda Payment Success`;
            log(msg, 'success');
            return { success: true, logs, message: msg };
        }

        if (paymentStatusData.exception_type === 'ApiPaymentRefusedException') {
            const msg = `[FAILURE] Card: ${card} | Response: Payment Failed - ${paymentStatusData.message}`;
            log(msg, 'error');
            return { success: false, logs, error: msg };
        }

        const threeDSURL = paymentStatusData.action && paymentStatusData.action.details ? paymentStatusData.action.details.url : null;

        if (!threeDSURL) {
            const msg = `[FAILURE] Card: ${card} | 3DS URL not found. Final status: ${paymentStatusData.status}`;
            log(msg, 'error');
            return { success: false, logs, error: msg };
        }

        log(`3DS URL Generated: ${threeDSURL}`, 'info');

        // 3DS Flow
        log('Starting 3DS authentication flow...', 'info');
        const tdsResponse = await axios.get(threeDSURL);
        const decodedDataString = atob(getString(tdsResponse.data, "window.__PROVIDER_PROPS__='", "'"));
        const bruceAuthToken = getString(decodedDataString, '"bruceAuthToken":"', '"');
        const bruceOwnerId = getString(decodedDataString, 'bruceOwnerId","id":"', '"');
        log('3DS authentication data obtained', 'success');

        const redirectDetailsUrl = `https://public-api.production.asia.fintech.deliveryhero.com/fp-ph/alfred.api/api/v2/alfred/payment/redirect/details?bruceOwnerId=${bruceOwnerId}&bruceAuthToken=${bruceAuthToken}&bruceOwnerType=Purchase`;
        const redirectDetailsResponse = await axios.get(redirectDetailsUrl);
        const sessionsInterceptorUrl = redirectDetailsResponse.data.redirect.url;
        log('Session interceptor URL obtained', 'success');

        const sessionsInterceptorResponse = await axios.get(sessionsInterceptorUrl);
        const transactionId = getString(sessionsInterceptorResponse.data, "transactionId: '", "'");
        const sessionId = getString(sessionsInterceptorResponse.data, "sessionId: '", "'");
        log(`Session ID: ${sessionId}`, 'info');
        log(`Transaction ID: ${transactionId}`, 'info');

        const deviceInfoUrl = `https://authentication-devices.checkout.com/sessions-interceptor/${sessionId}/device-information`;
        const deviceInfoPostfields = new URLSearchParams({
            'threeDSServerTransID': transactionId,
            'threeDSCompInd': 'Y',
            'browserScreenWidth': '2560',
            'browserScreenHeight': '1440',
            'browserColorDepth': '24',
            'browserUserAgent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
            'browserLanguage': 'en-US',
            'browserJavaEnabled': 'false',
            'browserTZ': '-360',
            'iframePaymentAllowed': 'true'
        });
        log('Sending device information...', 'info');
        await axios.post(deviceInfoUrl, deviceInfoPostfields, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        log('Device information sent', 'success');

        const longVerifyUrl = `https://authentication-devices.checkout.com/sessions-interceptor/${sessionId}/long-verify`;
        log('Calling long-verify...', 'info');
        const longVerifyResponse = await axios.get(longVerifyUrl);
        const redirectToUrl = longVerifyResponse.data.redirect_to_url;
        log('Long-verify response received', 'success');

        if (!redirectToUrl) {
            const msg = `[FAILURE] Card: ${card} | long-verify did not return a redirect URL after multiple attempts.`;
            log(msg, 'error');
            return { success: false, logs, error: msg };
        }

        log('Following 3DS redirect...', 'info');
        const redirectToResponse = await axios.get(redirectToUrl);
        log('3DS redirect completed', 'success');

        log('Committing payment...', 'info');
        const commitUrl = `https://public-api.production.asia.fintech.deliveryhero.com/fp-ph/alfred.api/api/v2/alfred/payment/redirect/Purchase:commit?bruceOwnerId=${bruceOwnerId}&bruceAuthToken=${bruceAuthToken}`;
        const commitPostfields = {
            parameters: {
                bruceOwnerType: 'Purchase',
                'cko-session-id': sessionId
            }
        };
        const finalResponse = await axios.post(commitUrl, commitPostfields);
        const finalData = finalResponse.data;
        log('Final response received', 'info');

        if (finalData.error && finalData.error.type === 'TechnicalError') {
            const msg = `[FAILURE] Card: ${card} | Response: TechnicalError`;
            log(msg, 'error');
            return { success: false, logs, error: msg };
        }

        const transactionStatus = finalData.transactionStatus;
        if (transactionStatus === 'Pending') {
            const msg = `[3DS REQ] Card: ${card} | Response: 3DS Required`;
            log(msg, 'warning');
            log(`3DS Authentication URL: ${finalData.merchantUrl}`, 'info');
            return { success: false, logs, error: msg, requires3DS: true, merchantUrl: finalData.merchantUrl };
        } else if (transactionStatus === 'Failure') {
            const code = finalData.errorInterface ? finalData.errorInterface.code : 'N/A';
            const message = finalData.errorInterface ? finalData.errorInterface.message : 'N/A';
            const msg = `[FAILURE] Card: ${card} | Response: Declined - (${code} - ${message})`;
            log(msg, 'error');
            return { success: false, logs, error: msg, code, message };
        } else if (transactionStatus === 'Success') {
            const msg = `[SUCCESS] Card: ${card} | Response: Purchase Success`;
            log(msg, 'success');
            return { success: true, logs, message: msg };
        } else {
            const msg = `[UNKNOWN] Card: ${card} | Unknown final status: ${JSON.stringify(finalData)}`;
            log(msg, 'warning');
            return { success: false, logs, error: msg, data: finalData };
        }

    } catch (error) {
        const msg = `[FAILURE] Card: ${card} | An error occurred during checkout.`;
        log(msg, 'error');
        if (error.response) {
            log(JSON.stringify(error.response.data, null, 2), 'error');
        } else {
            log(error.message, 'error');
        }
        return { success: false, logs, error: msg, errorDetails: error.message };
    }
}

module.exports = { processCardPayment }