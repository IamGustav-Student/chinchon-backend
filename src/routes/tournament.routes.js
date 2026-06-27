const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const { getCurrent, register, unregister, getBracket, getResult } = require('../controllers/tournament.controller');

router.get('/current', auth, getCurrent);
router.post('/register', auth, register);
router.delete('/register', auth, unregister);
router.get('/:id/bracket', auth, getBracket);
router.get('/:id/result', auth, getResult);

module.exports = router;
