const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const c = require('../controllers/truco.controller');

router.use(auth);
router.get('/list', c.listTables);
router.post('/create', c.createTable);
router.post('/join/:id', c.joinTable);

module.exports = router;
