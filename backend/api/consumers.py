"""
WebSocket Consumer - envia dados em tempo real para o frontend
"""
import json
import asyncio
import threading
import queue
from channels.generic.websocket import AsyncWebsocketConsumer


class ApiConsumer(AsyncWebsocketConsumer):
    """Consumer que processa requisições e envia dados em tempo real"""

    async def connect(self):
        await self.accept()

    async def disconnect(self, close_code):
        pass

    async def receive(self, text_data):
        """Recebe mensagem do frontend e envia resposta imediatamente"""
        try:
            data = json.loads(text_data)
            msg_type = data.get('type')
            payload = data.get('payload', {})

            # Copia sessão do scope para uso na thread
            self._session_data = dict(self.scope.get('session', {}))

            # Streaming: envia chunks progressivamente
            if msg_type == 'get_colaboradores_stream':
                await self._handle_colaboradores_stream(payload)
                return
            if msg_type == 'get_relatorios_stream':
                await self._handle_relatorios_stream(payload)
                return
            if msg_type == 'get_desempenho_stream':
                await self._handle_desempenho_stream(payload)
                return

            # Executa em thread separada para não bloquear
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._handle_request(msg_type, payload)
            )

            await self.send(text_data=json.dumps({
                'type': msg_type,
                'data': result,
                'status': 'ok'
            }))

        except Exception as e:
            msg_type = 'error'
            try:
                msg_type = data.get('type', 'error')
            except Exception:
                pass
            await self.send(text_data=json.dumps({
                'type': msg_type,
                'error': str(e),
                'status': 'error'
            }))

    async def _handle_colaboradores_stream(self, payload):
        """Processa colaboradores em lotes e envia chunks progressivamente"""
        q = queue.Queue()

        def processor():
            try:
                self._stream_colaboradores(q, payload)
            except Exception as e:
                q.put({'type': 'colaboradores_error', 'error': str(e), 'status': 'error'})
            finally:
                q.put(None)

        thread = threading.Thread(target=processor)
        thread.start()

        while True:
            chunk = await asyncio.get_event_loop().run_in_executor(None, q.get)
            if chunk is None:
                break
            await self.send(text_data=json.dumps(chunk))

    async def _handle_relatorios_stream(self, payload):
        """Busca chamados em lotes e envia chunks progressivamente"""
        q = queue.Queue()

        def processor():
            try:
                self._stream_relatorios(q, payload)
            except Exception as e:
                q.put({'type': 'relatorios_error', 'error': str(e), 'status': 'error'})
            finally:
                q.put(None)

        thread = threading.Thread(target=processor)
        thread.start()

        while True:
            chunk = await asyncio.get_event_loop().run_in_executor(None, q.get)
            if chunk is None:
                break
            await self.send(text_data=json.dumps(chunk))

    async def _handle_desempenho_stream(self, payload):
        """Busca tickets de desempenho em lotes e envia chunks progressivamente"""
        q = queue.Queue()

        def processor():
            try:
                self._stream_desempenho(q, payload)
            except Exception as e:
                q.put({'type': 'desempenho_error', 'error': str(e), 'status': 'error'})
            finally:
                q.put(None)

        thread = threading.Thread(target=processor)
        thread.start()

        while True:
            chunk = await asyncio.get_event_loop().run_in_executor(None, q.get)
            if chunk is None:
                break
            await self.send(text_data=json.dumps(chunk))

    def _handle_request(self, msg_type, payload):
        """Processa requisição de forma síncrona (chama código Django existente)"""
        # Sessão vem do scope (SessionMiddleware)
        session_data = self._session_data or {}
        glpi_token = session_data.get('glpi_session_token')

        if msg_type == 'get_desempenho':
            ano = payload.get('ano') or __import__('datetime').datetime.now().year
            return self._get_desempenho(glpi_token, session_data, ano)

        if msg_type == 'get_colaboradores':
            return self._get_colaboradores(glpi_token, payload)

        if msg_type == 'get_relatorios':
            return self._get_relatorios(glpi_token, payload)

        if msg_type == 'get_relatorios_filters':
            return self._get_relatorios_filters(glpi_token)

        return {'error': f'Tipo desconhecido: {msg_type}'}

    def _get_desempenho(self, glpi_token, session_data, ano):
        from portal.views import (
            build_performance_data,
            glpi_search_tickets_for_performance,
            glpi_get_full_session,
            extract_user_id_from_session,
            is_technical_profile,
        )

        profile = session_data.get('glpi_profile', '')
        if not is_technical_profile(profile):
            return {'error': 'Perfil técnico necessário'}

        if not glpi_token:
            return self._empty_desempenho(ano)

        full_session = glpi_get_full_session(glpi_token)
        user_id = extract_user_id_from_session(full_session)
        if not user_id:
            return self._empty_desempenho(ano)

        rows, _ = glpi_search_tickets_for_performance(glpi_token, user_id)
        result = build_performance_data(rows, int(ano))
        ano_atual = __import__('datetime').datetime.now().year
        result['available_years'] = list(range(ano_atual, ano_atual - 5, -1))
        return result

    def _empty_desempenho(self, ano):
        import calendar
        return {
            'assigned_total': 0, 'assigned_year_total': 0, 'pending_total': 0,
            'closed_this_month': 0, 'average_monthly_year': 0,
            'history_rows': [{'mes': calendar.month_name[m], 'capturados': 0, 'resolvidos': 0, 'backlog': 0, 'taxa_resolucao': 0} for m in range(1, 13)],
            'chart_labels': [calendar.month_abbr[m] for m in range(1, 13)],
            'chart_captured': [0] * 12, 'chart_resolved': [0] * 12,
            'chart_backlog': [0] * 12, 'chart_resolution_rate': [0] * 12,
            'total_captured_year': 0, 'total_resolved_year': 0,
            'current_backlog': 0, 'selected_year': ano,
            'available_years': list(range(int(ano), int(ano) - 5, -1)),
        }

    def _stream_colaboradores(self, q, payload):
        """Processa colaboradores em lotes e coloca chunks na fila para envio progressivo."""
        from django.core.cache import cache
        from portal.views import (
            glpi_list_users_range,
            process_single_user,
            merge_metrics,
            parse_date_filter,
        )
        from concurrent.futures import ThreadPoolExecutor, as_completed

        session_data = self._session_data or {}
        glpi_token = session_data.get('glpi_session_token')

        if not glpi_token:
            q.put({
                'type': 'colaboradores_done',
                'data': {'ranking': [], 'total_count': 0, 'data_inicio': '', 'data_fim': ''},
                'status': 'ok',
            })
            return

        data_inicio_str = payload.get('data_inicio', '')
        data_fim_str = payload.get('data_fim', '')
        data_inicio = parse_date_filter(data_inicio_str)
        data_fim = parse_date_filter(data_fim_str)

        cache_key = f"portal_colaboradores_ranking_v6_{data_inicio_str}_{data_fim_str}"
        cached = cache.get(cache_key)
        if cached:
            q.put({
                'type': 'colaboradores_done',
                'data': {
                    'ranking': cached,
                    'total_count': len(cached),
                    'data_inicio': data_inicio_str,
                    'data_fim': data_fim_str,
                },
                'status': 'ok',
            })
            return

        BATCH_SIZE = 50
        grouped = {}
        last_end = 0
        ranking_partial = []

        while True:
            users_batch, total_glpi = glpi_list_users_range(glpi_token, last_end, BATCH_SIZE)
            if not users_batch:
                break

            with ThreadPoolExecutor(max_workers=8) as executor:
                futures = [
                    executor.submit(process_single_user, glpi_token, u, data_inicio, data_fim)
                    for u in users_batch
                ]
                for future in as_completed(futures):
                    result = future.result()
                    if not result:
                        continue
                    base_login = result['base_login']
                    if not base_login:
                        continue
                    if base_login not in grouped:
                        grouped[base_login] = {
                            'nome': result['nome_exibicao'], 'usuarios_consolidados': [],
                            'total': 0, 'atribuidos': 0, 'pendentes': 0, 'resolvidos': 0,
                            'fechados': 0, 'backlog': 0,
                        }
                    grouped[base_login]['nome'] = result['nome_exibicao']
                    grouped[base_login]['usuarios_consolidados'].append(result['login_original'])
                    merge_metrics(grouped[base_login], result['metrics'])

            last_end += len(users_batch)
            ranking_partial = sorted(grouped.values(), key=lambda x: x['total'], reverse=True)
            ranking_partial = [r for r in ranking_partial if r['total'] > 0]

            q.put({
                'type': 'colaboradores_chunk',
                'data': {
                    'ranking': ranking_partial,
                    'total_count': len(ranking_partial),
                    'data_inicio': data_inicio_str,
                    'data_fim': data_fim_str,
                    'progress': min(last_end, total_glpi),
                    'total_users': total_glpi,
                },
                'status': 'streaming',
            })

            if last_end >= total_glpi:
                break

        cache.set(cache_key, ranking_partial, 300)
        q.put({
            'type': 'colaboradores_done',
            'data': {
                'ranking': ranking_partial,
                'total_count': len(ranking_partial),
                'data_inicio': data_inicio_str,
                'data_fim': data_fim_str,
            },
            'status': 'ok',
        })

    def _stream_relatorios(self, q, payload):
        """Busca chamados em lotes e coloca chunks na fila"""
        from relatorios.views import glpi_search_tickets, build_summary, parse_date

        session_data = self._session_data or {}
        glpi_token = session_data.get('glpi_session_token')

        if not glpi_token:
            q.put({
                'type': 'relatorios_done',
                'data': {'page': 1, 'limit': 20, 'total': 0, 'totalPages': 1, 'data': [], **{k: 0 for k in ['chamados_fechados', 'chamados_abertos', 'total_tecnicos', 'total_grupos']}},
                'status': 'ok',
            })
            return

        filters = {
            'data_inicio': parse_date(payload.get('data_inicio')),
            'data_fim': parse_date(payload.get('data_fim')),
            'tecnico': payload.get('tecnico') or '',
            'grupo': payload.get('grupo') or '',
            'localizacao': payload.get('localizacao') or '',
            'categoria': payload.get('categoria') or '',
        }

        BATCH_SIZE = 100
        all_chamados = []
        start = 0

        while True:
            chamados, total = glpi_search_tickets(glpi_token, filters, start=start, limit=BATCH_SIZE)
            if not chamados:
                break

            all_chamados.extend(chamados)
            summary = build_summary(all_chamados, filters)
            total_pages = max(1, (total + 19) // 20) if total else 1

            q.put({
                'type': 'relatorios_chunk',
                'data': {
                    'data': all_chamados,
                    'total': total,
                    'totalPages': total_pages,
                    'progress': min(len(all_chamados), total),
                    'total_tickets': total,
                    **summary,
                },
                'status': 'streaming',
            })

            start += len(chamados)
            if start >= total:
                break

        summary = build_summary(all_chamados, filters)
        q.put({
            'type': 'relatorios_done',
            'data': {
                'page': 1,
                'limit': 20,
                'total': len(all_chamados),
                'totalPages': max(1, (len(all_chamados) + 19) // 20),
                'data': all_chamados,
                **summary,
            },
            'status': 'ok',
        })

    def _stream_desempenho(self, q, payload):
        """Busca tickets de desempenho em lotes e envia chunks progressivamente"""
        from portal.views import (
            glpi_search_tickets_for_performance,
            build_performance_data,
            glpi_get_full_session,
            extract_user_id_from_session,
            is_technical_profile,
        )
        import calendar

        session_data = self._session_data or {}
        glpi_token = session_data.get('glpi_session_token')

        if not glpi_token:
            q.put({'type': 'desempenho_error', 'error': 'Nao autenticado', 'status': 'error'})
            return

        profile = session_data.get('glpi_profile', '')
        if not is_technical_profile(profile):
            q.put({'type': 'desempenho_error', 'error': 'Perfil tecnico necessario', 'status': 'error'})
            return

        full_session = glpi_get_full_session(glpi_token)
        user_id = extract_user_id_from_session(full_session)
        if not user_id:
            q.put({'type': 'desempenho_done', 'data': self._empty_desempenho(int(payload.get('ano') or __import__('datetime').datetime.now().year)), 'status': 'ok'})
            return

        ano = int(payload.get('ano') or __import__('datetime').datetime.now().year)
        BATCH_SIZE = 200
        all_rows = []
        start = 0

        while True:
            rows, total = glpi_search_tickets_for_performance(glpi_token, user_id, start=start, limit=BATCH_SIZE)
            if not rows:
                break

            all_rows.extend(rows)
            result = build_performance_data(all_rows, ano)
            ano_atual = __import__('datetime').datetime.now().year
            result['available_years'] = list(range(ano_atual, ano_atual - 5, -1))

            result_copy = dict(result)
            result_copy['progress'] = len(all_rows)
            result_copy['total_tickets'] = total
            q.put({
                'type': 'desempenho_chunk',
                'data': result_copy,
                'status': 'streaming',
            })

            start += len(rows)
            if start >= total:
                break

        result = build_performance_data(all_rows, ano)
        result['available_years'] = list(range(__import__('datetime').datetime.now().year, __import__('datetime').datetime.now().year - 5, -1))
        q.put({
            'type': 'desempenho_done',
            'data': result,
            'status': 'ok',
        })

    def _get_colaboradores(self, glpi_token, payload):
        from django.core.cache import cache
        from portal.views import (
            glpi_list_users,
            process_single_user,
            merge_metrics,
            parse_date_filter,
        )
        from concurrent.futures import ThreadPoolExecutor, as_completed

        if not glpi_token:
            return {'ranking': [], 'total_count': 0, 'data_inicio': '', 'data_fim': ''}

        data_inicio_str = payload.get('data_inicio', '')
        data_fim_str = payload.get('data_fim', '')
        data_inicio = parse_date_filter(data_inicio_str)
        data_fim = parse_date_filter(data_fim_str)

        cache_key = f"portal_colaboradores_ranking_v6_{data_inicio_str}_{data_fim_str}"
        cached = cache.get(cache_key)
        if cached:
            ranking_full = cached
        else:
            users = glpi_list_users(glpi_token)
            grouped = {}
            with ThreadPoolExecutor(max_workers=8) as executor:
                futures = [
                    executor.submit(process_single_user, glpi_token, u, data_inicio, data_fim)
                    for u in users
                ]
                for future in as_completed(futures):
                    result = future.result()
                    if not result:
                        continue
                    base_login = result['base_login']
                    if not base_login:
                        continue
                    if base_login not in grouped:
                        grouped[base_login] = {
                            'nome': result['nome_exibicao'], 'usuarios_consolidados': [],
                            'total': 0, 'atribuidos': 0, 'pendentes': 0, 'resolvidos': 0,
                            'fechados': 0, 'backlog': 0,
                        }
                    grouped[base_login]['nome'] = result['nome_exibicao']
                    grouped[base_login]['usuarios_consolidados'].append(result['login_original'])
                    merge_metrics(grouped[base_login], result['metrics'])
            ranking_full = sorted(grouped.values(), key=lambda x: x['total'], reverse=True)
            ranking_full = [r for r in ranking_full if r['total'] > 0]
            cache.set(cache_key, ranking_full, 300)

        return {
            'ranking': ranking_full,
            'total_count': len(ranking_full),
            'data_inicio': data_inicio_str,
            'data_fim': data_fim_str,
        }

    def _get_relatorios_filters(self, glpi_token):
        from relatorios.views import glpi_search_users, glpi_get_dropdown

        if not glpi_token:
            return {'tecnicos': [], 'grupos': [], 'localizacoes': [], 'categorias': []}

        return {
            'tecnicos': glpi_search_users(glpi_token),
            'grupos': glpi_get_dropdown('Group', glpi_token),
            'localizacoes': glpi_get_dropdown('Location', glpi_token),
            'categorias': glpi_get_dropdown('ITILCategory', glpi_token),
        }

    def _get_relatorios(self, glpi_token, payload):
        from relatorios.views import glpi_search_tickets, build_summary, parse_date

        if not glpi_token:
            return {
                'page': 1,
                'limit': 20,
                'total': 0,
                'totalPages': 1,
                'data': [],
                'chamados': [],
                'total_chamados': 0,
                'chamados_fechados': 0,
                'chamados_abertos': 0,
                'total_tecnicos': 0,
                'total_grupos': 0,
            }

        filters = {
            'data_inicio': parse_date(payload.get('data_inicio')),
            'data_fim': parse_date(payload.get('data_fim')),
            'tecnico': payload.get('tecnico') or '',
            'grupo': payload.get('grupo') or '',
            'localizacao': payload.get('localizacao') or '',
            'categoria': payload.get('categoria') or '',
        }
        page = max(1, int(payload.get('page', 1)))
        limit = min(100, max(1, int(payload.get('limit', 20))))
        start = (page - 1) * limit
        chamados, total = glpi_search_tickets(glpi_token, filters, start=start, limit=limit)
        total_pages = max(1, (total + limit - 1) // limit) if total else 1
        summary = build_summary(chamados, filters)
        return {
            'page': page,
            'limit': limit,
            'total': total,
            'totalPages': total_pages,
            'data': chamados,
            'chamados': chamados,
            'total_chamados': total,
            **summary,
        }
