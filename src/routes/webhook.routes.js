const express = require('express');
const router = express.Router();
const { mercadoPagoWebhook } = require('../controllers/webhook.controller');

router.post('/mercadopago', mercadoPagoWebhook);

module.exports = router;
