import { getQuery } from 'h3'
import { searchGrafanaDashboards } from '../../../utils/observability-store'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  return searchGrafanaDashboards(typeof query.query === 'string' ? query.query : '')
})
