const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const isAdmin = require('../middlewares/admin.middleware');
const { validIdParam } = require('../middlewares/admin.middleware');
const c = require('../controllers/admin.controller');

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, esperá un minuto' },
});

router.use(auth, isAdmin, adminLimiter);

router.get('/stats', c.getStats);

router.get('/users', c.getUsers);
router.post('/users/:id/ban', validIdParam, c.banUser);
router.post('/users/:id/unban', validIdParam, c.unbanUser);
router.put('/users/:id/balance', validIdParam, c.editBalance);
router.put('/users/:id/role', validIdParam, c.setRole);
router.put('/users/:id/email', validIdParam, c.updateEmail);

router.get('/deposits', c.getDeposits);
router.post('/deposits/:id/approve', validIdParam, c.approveDeposit);
router.post('/deposits/:id/reject', validIdParam, c.rejectDeposit);

router.get('/tables', c.getTables);
router.delete('/tables/:id', c.closeTable);

router.get('/tournament', c.getTournament);
router.post('/tournament/start', c.startTournament);
router.post('/tournament/cancel', c.cancelTournament);

module.exports = router;
