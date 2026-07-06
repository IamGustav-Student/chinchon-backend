const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const { getProfile, updateProfile, getConfig, purchaseItem } = require('../controllers/profile.controller');

router.get('/', auth, getProfile);
router.put('/', auth, updateProfile);
router.post('/purchase-item', auth, purchaseItem);
router.get('/general-config', getConfig);

module.exports = router;
