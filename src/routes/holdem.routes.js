const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.middleware');
const { listTables, getTable, createTable, joinTable, rebuy } = require('../controllers/holdem.controller');

router.get('/list',        auth, listTables);
router.get('/:id',         auth, getTable);
router.post('/create',     auth, createTable);
router.post('/join/:id',   auth, joinTable);
router.post('/:id/rebuy',  auth, rebuy);

module.exports = router;
