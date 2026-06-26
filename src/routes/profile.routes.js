const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const { getProfile, updateProfile, getConfig } = require('../controllers/profile.controller');

router.get('/', auth, getProfile);
router.put('/', auth, updateProfile);
router.get('/general-config', getConfig);

module.exports = router;
