const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const { getDepositInfo, getBalance, deposit, withdraw, getHistory } = require('../controllers/wallet.controller');

router.get('/deposit-info', auth, getDepositInfo);
router.get('/balance', auth, getBalance);
router.post('/deposit', auth, deposit);
router.post('/withdraw', auth, withdraw);
router.get('/history', auth, getHistory);

module.exports = router;
