/** Permisos del panel ISP — alineados con requireRole() en la API. */

export type IspStaffRole = 'admin' | 'technician' | 'office' | 'client' | 'superadmin' | string

export const ispPermissions = {
  /** CRM abonados */
  createClient: (r?: string) => r === 'admin' || r === 'office',
  editClient: (r?: string) => r === 'admin' || r === 'office',
  deleteClient: (r?: string) => r === 'admin',

  /** Servicios de internet */
  createService: (r?: string) => r === 'admin',
  deleteService: (r?: string) => r === 'admin',
  editService: (r?: string) => r === 'admin',
  suspendService: (r?: string) => r === 'admin' || r === 'technician',
  reactivateService: (r?: string) => r === 'admin' || r === 'technician',
  provisionService: (r?: string) => r === 'admin' || r === 'technician',

  /** Facturación */
  viewInvoices: (r?: string) => r === 'admin' || r === 'office' || r === 'technician',
  registerPayment: (r?: string) => r === 'admin' || r === 'office',
  createManualInvoice: (r?: string) => r === 'admin' || r === 'office',
  generateInvoices: (r?: string) => r === 'admin',
  generateServiceInvoice: (r?: string) => r === 'admin',

  /** Red e inventario */
  manageRouters: (r?: string) => r === 'admin',
  adoptDevice: (r?: string) => r === 'admin',
  scanNetwork: (r?: string) => r === 'admin' || r === 'technician',
  editEquipment: (r?: string) => r === 'admin',

  /** Organización */
  manageStaff: (r?: string) => r === 'admin',
  billingSettings: (r?: string) => r === 'admin',
  managePlans: (r?: string) => r === 'admin',
  finance: (r?: string) => r === 'admin' || r === 'office',
}

export function canCreateInTab(tab: string, role?: string) {
  if (role === 'technician') return false
  switch (tab) {
    case 'clients':
      return ispPermissions.createClient(role)
    case 'plans':
      return ispPermissions.managePlans(role)
    case 'tickets':
      return role === 'admin' || role === 'technician'
    default:
      return role === 'admin'
  }
}
