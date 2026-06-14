const crypto = require('crypto');

const cardCipher = {
    async encrypt(cardJsonString, intentId, version, recipientPublicKeyBase64) {
        // const recipientPublicKeyBase64 = "{$a['config']['keyId']}";

        const { publicKey: devicePubKey, privateKey: devicePrivKey } = crypto.generateKeyPairSync('ec', {
            namedCurve: 'prime256v1',
        });

        const devicePubRaw = devicePubKey.export({ format: 'der', type: 'spki' });
        const devicePubLen = devicePubRaw.length;

        const recipientPubKey = crypto.createPublicKey({
            key: Buffer.from(recipientPublicKeyBase64, 'base64'),
            format: 'der',
            type: 'spki',
        });

        const sharedSecret = crypto.diffieHellman({
            privateKey: devicePrivKey,
            publicKey: recipientPubKey,
        });

        const derivedKey = crypto.createHash('sha256')
            .update(Buffer.concat([sharedSecret, devicePubRaw, Buffer.from(recipientPublicKeyBase64, 'base64')]))
            .digest();

        const iv = crypto.randomBytes(12);
        const aad = Buffer.concat([
            Buffer.from(intentId, 'utf-8'),
            devicePubRaw,
            iv,
            Buffer.from('dhft||' + version + '||' + intentId + '||' + devicePubLen)
        ]);

        const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
        cipher.setAAD(aad);

        const encrypted = Buffer.concat([
            cipher.update(Buffer.from(cardJsonString, 'utf-8')),
            cipher.final()
        ]);

        const tag = cipher.getAuthTag();
        const payload = Buffer.concat([devicePubRaw, iv, encrypted, tag]);
        const base64Body = payload.toString('base64').replace(/=+$/, '');

        const header = 'dhft||' + version + '||' + intentId + '||' + devicePubLen;
        return header + '||' + base64Body;
    }
};

async function encrypt(intentId, cardNumber, recipientPublicKeyBase64) {
    // const cardNumber = cc;
    const cvv = '';
    const extendedBin = cardNumber.substring(0, 8);

    const cardData = {
        cardNumber,
        cvv
    };

    // const intentId = "{$a['config']['bruceOwnerData']['intentId']}";
    const version = 2;

    const encrypted_data = await cardCipher.encrypt(
        JSON.stringify(cardData),
        intentId,
        parseInt(version),
        recipientPublicKeyBase64
    );

    console.log(encrypted_data);

    return encrypted_data;
}

module.exports = { encrypt }